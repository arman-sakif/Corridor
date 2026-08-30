import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createUser, migratedDatabase, type TestDb } from './harness.ts';

/**
 * The in-app notification list, checked at the layer that has to be right.
 *
 * This is the channel that actually reaches people while email goes through a
 * sandbox sender that delivers to one address — so "can somebody read someone
 * else's notifications" is not a theoretical question here.
 */

describe('notifications', () => {
  let test: TestDb;
  let alice: string;
  let bob: string;

  before(async () => {
    test = await migratedDatabase();
    alice = await createUser(test, { email: 'alice@example.com', name: 'Alice' });
    bob = await createUser(test, { email: 'bob@example.com', name: 'Bob' });

    // notify() writes with the service-role key, which is the only thing that
    // may insert here.
    await test.raw(
      `insert into public.notifications (user_id, kind, subject, body, link)
       values ($1, 'booking_approved', 'Your seat is confirmed', 'See you Tuesday.', '/my-rides'),
              ($1, 'seat_requested',   'A seat has been requested', 'Someone wants a seat.', null),
              ($2, 'booking_declined', 'Your seat request was declined', 'No room.', null)`,
      [alice, bob],
    );
  });

  after(async () => test.close());

  it('shows a person their own notifications and nobody else’s', async () => {
    const hers = await test.asUser<{ subject: string }>(
      alice,
      `select subject from public.notifications order by subject`,
    );

    assert.deepEqual(
      hers.map((row) => row.subject),
      ['A seat has been requested', 'Your seat is confirmed'],
    );

    const his = await test.asUser<{ subject: string }>(
      bob,
      `select subject from public.notifications`,
    );
    assert.deepEqual(
      his.map((row) => row.subject),
      ['Your seat request was declined'],
    );
  });

  it('tells a signed-out visitor nothing at all', async () => {
    // Refused at the privilege gate, before RLS is consulted: anon holds no
    // grant on this table, which is the stronger answer than an empty result.
    await assert.rejects(
      test.asAnon(`select * from public.notifications`),
      /permission denied/i,
    );
  });

  it('marks everything unread as read, and reports how many', async () => {
    const [row] = await test.asUser<{ mark_notifications_read: number }>(
      alice,
      `select public.mark_notifications_read()`,
    );
    assert.equal(row!.mark_notifications_read, 2);

    const unread = await test.asUser(
      alice,
      `select id from public.notifications where read_at is null`,
    );
    assert.equal(unread.length, 0);

    // Bob's stays unread: the function scopes itself to the caller.
    const bobUnread = await test.asUser(
      bob,
      `select id from public.notifications where read_at is null`,
    );
    assert.equal(bobUnread.length, 1);
  });

  it('cannot be used to mark someone else’s notifications read', async () => {
    const [bobsRow] = await test.raw<{ id: string }>(
      `select id from public.notifications where user_id = $1`,
      [bob],
    );

    // Alice naming Bob's id explicitly still changes nothing: the function
    // filters by auth.uid() before it looks at the list it was handed.
    const [result] = await test.asUser<{ mark_notifications_read: number }>(
      alice,
      `select public.mark_notifications_read(array[$1]::uuid[])`,
      [bobsRow!.id],
    );
    assert.equal(result!.mark_notifications_read, 0);

    const [still] = await test.raw<{ read_at: string | null }>(
      `select read_at from public.notifications where id = $1`,
      [bobsRow!.id],
    );
    assert.equal(still!.read_at, null);
  });

  it('is read-only to the API, so nobody can rewrite what they were told', async () => {
    // RLS governs rows, not columns. An update policy scoped to "your own row"
    // would also permit rewriting the subject and body of a message an
    // operator sent you, so there is no update policy and no update privilege.
    await assert.rejects(
      test.asUser(alice, `update public.notifications set subject = 'Nothing happened'`),
      /permission denied/i,
    );

    await assert.rejects(
      test.asUser(
        alice,
        `insert into public.notifications (user_id, kind, subject, body)
         values ($1, 'booking_approved', 'Fake', 'Made up')`,
        [alice],
      ),
      /permission denied/i,
    );

    await assert.rejects(
      test.asUser(alice, `delete from public.notifications`),
      /permission denied/i,
    );
  });

  it('has no room in the type for a credential', async () => {
    // login_code and password_reset are emailed and never filed: their reader
    // is locked out, so an in-app list is the one place they cannot look. The
    // enum omits them so a mistake in TypeScript fails here rather than
    // quietly storing a working sign-in code.
    await assert.rejects(
      test.raw(
        `insert into public.notifications (user_id, kind, subject, body)
         values ($1, 'login_code', 'Your code', '123456')`,
        [alice],
      ),
      /invalid input value for enum/i,
    );
  });
});
