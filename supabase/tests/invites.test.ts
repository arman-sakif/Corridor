import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createUser, migratedDatabase, type TestDb } from './harness.ts';

/**
 * Inviting someone to a team before they have an account.
 *
 * The signup path is the part worth guarding. Two triggers fire on a new
 * auth.users row — one creates the profile, one redeems any invites — and
 * operator_members references profiles, so they have to run in that order.
 * Postgres decides that alphabetically by trigger name, which is exactly the
 * kind of thing a later rename breaks silently. These tests are what would
 * notice.
 */

describe('operator invites', () => {
  let test: TestDb;
  let owner: string;
  let outsider: string;
  let operatorId: string;

  before(async () => {
    test = await migratedDatabase();

    owner = await createUser(test, { email: 'owner@example.com', name: 'Owner' });
    outsider = await createUser(test, { email: 'outsider@example.com', name: 'Outsider' });

    const [operator] = await test.asUser<{ id: string }>(
      owner,
      `insert into public.operators (name, public_phone, created_by)
       values ('Invite Test Rideshare', '519-555-0199', $1) returning id`,
      [owner],
    );
    operatorId = operator!.id;
  });

  after(async () => test.close());

  it('lets an owner record someone who has no account yet', async () => {
    const rows = await test.asUser<{ id: string }>(
      owner,
      `insert into public.operator_invites (operator_id, email, role, invited_by)
       values ($1, 'newdriver@example.com', 'driver', $2) returning id`,
      [operatorId, owner],
    );
    assert.equal(rows.length, 1);
  });

  it('puts them on the team the moment they sign up', async () => {
    const driver = await createUser(test, { email: 'newdriver@example.com', name: 'New Driver' });

    const memberships = await test.raw<{ role: string; operator_id: string }>(
      `select role, operator_id from public.operator_members where user_id = $1`,
      [driver],
    );

    assert.deepEqual(memberships, [{ role: 'driver', operator_id: operatorId }]);
  });

  it('marks the invite accepted, so it is not redeemed twice', async () => {
    const [invite] = await test.raw<{ accepted_at: string | null; accepted_by: string | null }>(
      `select accepted_at, accepted_by from public.operator_invites
        where lower(email) = 'newdriver@example.com'`,
    );

    assert.notEqual(invite!.accepted_at, null);
    assert.notEqual(invite!.accepted_by, null);
  });

  it('matches the address whatever case it was typed in', async () => {
    await test.asUser(
      owner,
      `insert into public.operator_invites (operator_id, email, role, invited_by)
       values ($1, 'Mixed.Case@Example.com', 'staff', $2)`,
      [operatorId, owner],
    );

    const member = await createUser(test, {
      email: 'mixed.case@example.com',
      name: 'Mixed Case',
    });

    const [row] = await test.raw<{ role: string }>(
      `select role from public.operator_members where user_id = $1`,
      [member],
    );
    assert.equal(row!.role, 'staff');
  });

  it('refuses a second open invite for the same address', async () => {
    await test.asUser(
      owner,
      `insert into public.operator_invites (operator_id, email, role, invited_by)
       values ($1, 'twice@example.com', 'driver', $2)`,
      [operatorId, owner],
    );

    await assert.rejects(
      test.asUser(
        owner,
        `insert into public.operator_invites (operator_id, email, role, invited_by)
         values ($1, 'twice@example.com', 'staff', $2)`,
        [operatorId, owner],
      ),
      /duplicate key|unique/i,
    );
  });

  it('hides invites from everyone but the operator’s owners', async () => {
    const seen = await test.asUser(outsider, `select id from public.operator_invites`);
    assert.deepEqual(seen, []);

    await assert.rejects(
      test.asAnon(`select * from public.operator_invites`),
      /permission denied/i,
    );
  });

  it('does not let an outsider invite themselves onto a team', async () => {
    await assert.rejects(
      test.asUser(
        outsider,
        `insert into public.operator_invites (operator_id, email, role, invited_by)
         values ($1, 'outsider@example.com', 'owner', $2)`,
        [operatorId, outsider],
      ),
      /row-level security/i,
    );
  });

  it('leaves a signup with no invite exactly as it was', async () => {
    const nobody = await createUser(test, { email: 'nobody@example.com', name: 'Nobody' });

    const memberships = await test.raw(
      `select id from public.operator_members where user_id = $1`,
      [nobody],
    );
    assert.deepEqual(memberships, []);
  });
});
