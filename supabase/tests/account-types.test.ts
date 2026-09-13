import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createUser, migratedDatabase, type TestDb } from './harness.ts';
import { passenger, seedCorridor, type Corridor } from './seed.ts';

/**
 * Account types a person switches for themselves — only downstream of a role
 * they already hold. An owner can switch on driving and passenger; staff,
 * drivers and admins can switch passenger; a plain passenger switches nothing.
 * Operator and admin are granted, never switched on.
 */

describe('account types', () => {
  let test: TestDb;
  let corridor: Corridor;
  let rider: string;
  let staff: string;
  let driver: string;
  let admin: string;

  async function flags(id: string) {
    const [row] = await test.raw<{ passenger_enabled: boolean; drives_enabled: boolean }>(
      `select passenger_enabled, drives_enabled from public.profiles where id = $1`,
      [id],
    );
    return row!;
  }

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test);

    rider = await passenger(test, 'Plain Rider');
    staff = await passenger(test, 'Office Staff');
    driver = await passenger(test, 'Road Driver');
    for (const [user, role] of [
      [staff, 'staff'],
      [driver, 'driver'],
    ] as const) {
      await test.asUser(
        corridor.ownerId,
        `insert into public.operator_members (operator_id, user_id, role) values ($1, $2, $3)`,
        [corridor.operatorId, user, role],
      );
    }

    admin = await passenger(test, 'Platform Admin');
    await test.raw(`update public.profiles set platform_role = 'admin' where id = $1`, [admin]);
  });

  after(async () => test.close());

  it('starts a new signup as a passenger who does not drive', async () => {
    assert.deepEqual(await flags(rider), { passenger_enabled: true, drives_enabled: false });
  });

  it('refuses a direct update, even to your own row', async () => {
    // RLS lets anyone update their own profile row; the trigger is what stops
    // a passenger writing themselves a driver account.
    await assert.rejects(
      test.asUser(rider, `update public.profiles set drives_enabled = true where id = $1`, [rider]),
      /set_account_mode/,
    );
    await assert.rejects(
      test.asUser(
        corridor.ownerId,
        `update public.profiles set passenger_enabled = false where id = $1`,
        [corridor.ownerId],
      ),
      /set_account_mode/,
    );
  });

  it('lets a plain passenger switch nothing', async () => {
    await assert.rejects(
      test.asUser(rider, `select public.set_account_mode('passenger', false)`),
      /only account type/,
    );
    await assert.rejects(
      test.asUser(rider, `select public.set_account_mode('driver', true)`),
      /business owner/,
    );
    assert.deepEqual(await flags(rider), { passenger_enabled: true, drives_enabled: false });
  });

  it('lets an owner switch driving and passenger for themselves', async () => {
    await test.asUser(corridor.ownerId, `select public.set_account_mode('driver', true)`);
    await test.asUser(corridor.ownerId, `select public.set_account_mode('passenger', false)`);
    assert.deepEqual(await flags(corridor.ownerId), {
      passenger_enabled: false,
      drives_enabled: true,
    });

    await test.asUser(corridor.ownerId, `select public.set_account_mode('passenger', true)`);
    assert.equal((await flags(corridor.ownerId)).passenger_enabled, true);
  });

  it('lets staff, drivers and admins switch passenger, and nothing above it', async () => {
    for (const who of [staff, driver, admin]) {
      await test.asUser(who, `select public.set_account_mode('passenger', false)`);
      assert.equal((await flags(who)).passenger_enabled, false);

      await assert.rejects(
        test.asUser(who, `select public.set_account_mode('driver', true)`),
        /business owner/,
      );
    }
  });

  it('grants operator and admin rather than switching them on', async () => {
    for (const mode of ['operator', 'admin']) {
      await assert.rejects(
        test.asUser(corridor.ownerId, `select public.set_account_mode($1, true)`, [mode]),
        /granted, not switched on/,
      );
    }
  });

  it('starts someone who joins by invite without passenger', async () => {
    await test.asUser(
      corridor.ownerId,
      `insert into public.operator_invites (operator_id, email, role, invited_by)
       values ($1, 'invited.driver@example.com', 'driver', $2)`,
      [corridor.operatorId, corridor.ownerId],
    );

    const invited = await createUser(test, {
      email: 'invited.driver@example.com',
      name: 'Invited Driver',
    });

    assert.equal((await flags(invited)).passenger_enabled, false);
    const [member] = await test.raw<{ role: string }>(
      `select role from public.operator_members where user_id = $1`,
      [invited],
    );
    assert.equal(member?.role, 'driver', 'and still joins the team');
  });
});
