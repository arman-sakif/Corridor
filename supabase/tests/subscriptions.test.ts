import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createUser, migratedDatabase, type TestDb } from './harness.ts';
import { seedCorridor, type Corridor } from './seed.ts';

/**
 * What an operator owes, and what they have paid.
 *
 * Subscriptions were the one feature area with no coverage at all — the table
 * has existed since the first migration and nothing has ever asserted who may
 * read or write it. These are those assertions, plus the ledger added with the
 * amount.
 */

describe('subscriptions', () => {
  let test: TestDb;
  let corridor: Corridor;

  let admin: string;
  let rivalOwner: string;
  let outsider: string;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test);

    admin = await createUser(test, { email: 'admin@example.com', name: 'Platform Admin' });
    await test.raw(`update public.profiles set platform_role = 'admin' where id = $1`, [admin]);

    rivalOwner = await createUser(test, { email: 'rival@example.com', name: 'Rival Owner' });
    await test.raw(
      `insert into public.operators (name, public_phone, status, created_by)
       values ('Rival Rideshare', '519-555-0188', 'active', $1)`,
      [rivalOwner],
    );

    outsider = await createUser(test, { email: 'nobody@example.com', name: 'Nobody' });

    await test.asUser(
      admin,
      `insert into public.subscriptions (operator_id, plan, status, amount_cents, current_period_end)
       values ($1, 'monthly', 'active', 12000, '2026-09-30')`,
      [corridor.operatorId],
    );

    await test.asUser(
      admin,
      `insert into public.subscription_payments (operator_id, amount_cents, paid_on, covers_until, recorded_by)
       values ($1, 12000, '2026-08-30', '2026-09-30', $2)`,
      [corridor.operatorId, admin],
    );
  });

  after(async () => test.close());

  it('lets an operator read what it owes and what it has paid', async () => {
    const [subscription] = await test.asUser<{ amount_cents: number; plan: string }>(
      corridor.ownerId,
      `select amount_cents, plan from public.subscriptions`,
    );

    assert.equal(subscription!.amount_cents, 12000);
    assert.equal(subscription!.plan, 'monthly');

    const payments = await test.asUser<{ amount_cents: number }>(
      corridor.ownerId,
      `select amount_cents from public.subscription_payments`,
    );
    assert.deepEqual(payments, [{ amount_cents: 12000 }]);
  });

  it('shows one operator nothing of another’s money', async () => {
    const subs = await test.asUser(rivalOwner, `select id from public.subscriptions`);
    assert.deepEqual(subs, [], 'a rival must not see what someone else pays');

    const payments = await test.asUser(rivalOwner, `select id from public.subscription_payments`);
    assert.deepEqual(payments, []);

    const none = await test.asUser(outsider, `select id from public.subscription_payments`);
    assert.deepEqual(none, [], 'somebody on no team sees nothing at all');
  });

  it('tells a signed-out visitor nothing', async () => {
    // Refused at the privilege gate, before RLS is consulted.
    for (const table of ['subscriptions', 'subscription_payments']) {
      await assert.rejects(
        test.asAnon(`select * from public.${table}`),
        /permission denied/i,
        `anon must not read ${table}`,
      );
    }
  });

  it('lets only an admin record a payment', async () => {
    // The operator can read its own ledger and must not be able to add to it —
    // "I paid you" is a claim, not a record.
    await assert.rejects(
      test.asUser(
        corridor.ownerId,
        `insert into public.subscription_payments (operator_id, amount_cents, paid_on)
         values ($1, 99900, '2026-08-30')`,
        [corridor.operatorId],
      ),
      /row-level security/i,
    );

    // An UPDATE that RLS denies does not raise — the rows simply are not
    // visible to it, so it reports success having changed nothing. Asserting a
    // rejection here would pass for the wrong reason the day the policy broke,
    // so assert the money instead.
    await test.asUser(corridor.ownerId, `update public.subscription_payments set amount_cents = 1`);

    const [untouched] = await test.raw<{ amount_cents: number }>(
      `select amount_cents from public.subscription_payments order by paid_on limit 1`,
    );
    assert.equal(untouched!.amount_cents, 12000, 'the operator must not be able to edit the ledger');

    const rows = await test.asUser<{ id: string }>(
      admin,
      `insert into public.subscription_payments (operator_id, amount_cents, paid_on, recorded_by)
       values ($1, 12000, '2026-09-30', $2) returning id`,
      [corridor.operatorId, admin],
    );
    assert.equal(rows.length, 1);
  });

  it('lets only an admin set what an operator owes', async () => {
    // Again: denied by RLS means invisible, not refused. The operator's update
    // succeeds against nothing.
    await test.asUser(
      corridor.ownerId,
      `update public.subscriptions set amount_cents = 0 where operator_id = $1`,
      [corridor.operatorId],
    );

    const [unchanged] = await test.raw<{ amount_cents: number }>(
      `select amount_cents from public.subscriptions where operator_id = $1`,
      [corridor.operatorId],
    );
    assert.equal(unchanged!.amount_cents, 12000, 'an operator must not set its own price');

    await test.asUser(
      admin,
      `update public.subscriptions set amount_cents = 15000 where operator_id = $1`,
      [corridor.operatorId],
    );

    const [row] = await test.asUser<{ amount_cents: number }>(
      corridor.ownerId,
      `select amount_cents from public.subscriptions`,
    );
    assert.equal(row!.amount_cents, 15000);
  });

  it('refuses a negative amount on either table', async () => {
    await assert.rejects(
      test.asUser(admin, `update public.subscriptions set amount_cents = -1 where operator_id = $1`, [
        corridor.operatorId,
      ]),
      /amount_non_negative/i,
    );

    await assert.rejects(
      test.asUser(
        admin,
        `insert into public.subscription_payments (operator_id, amount_cents, paid_on)
         values ($1, -500, '2026-08-30')`,
        [corridor.operatorId],
      ),
      /amount_non_negative/i,
    );
  });
});
