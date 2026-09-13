import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  availableModes,
  destinationFor,
  homeFor,
  modeForPath,
  resolveMode,
  toggleableModes,
  type ModeViewer,
} from './modes.ts';

function viewer(partial: Partial<ModeViewer> = {}): ModeViewer {
  return {
    isAdmin: false,
    memberships: [],
    profile: { passenger_enabled: true, drives_enabled: false },
    ...partial,
  };
}

const OWNER = { operator_id: 'op-1', role: 'owner' as const };
const STAFF = { operator_id: 'op-2', role: 'staff' as const };
const DRIVER = { operator_id: 'op-3', role: 'driver' as const };

describe('availableModes', () => {
  it('gives a plain signup passenger and nothing else', () => {
    assert.deepEqual(availableModes(viewer()), ['passenger']);
  });

  it('gives an owner operator, and driver only once switched on', () => {
    const off = viewer({ memberships: [OWNER], profile: { passenger_enabled: false, drives_enabled: false } });
    const on = viewer({ memberships: [OWNER], profile: { passenger_enabled: true, drives_enabled: true } });
    assert.deepEqual(availableModes(off), ['operator']);
    assert.deepEqual(availableModes(on), ['operator', 'driver', 'passenger']);
  });

  it('puts staff on the operator dashboard, and never lets them drive by the owner flag', () => {
    const staff = viewer({ memberships: [STAFF], profile: { passenger_enabled: false, drives_enabled: true } });
    assert.deepEqual(availableModes(staff), ['operator']);
  });

  it('gives an invited driver the driver type', () => {
    const driver = viewer({ memberships: [DRIVER], profile: { passenger_enabled: false, drives_enabled: false } });
    assert.deepEqual(availableModes(driver), ['driver']);
  });

  it('lists an admin first, and adds business roles only when they belong to one', () => {
    assert.deepEqual(
      availableModes(viewer({ isAdmin: true, profile: { passenger_enabled: false, drives_enabled: false } })),
      ['admin'],
    );
    assert.deepEqual(availableModes(viewer({ isAdmin: true, memberships: [STAFF] })), [
      'admin',
      'operator',
      'passenger',
    ]);
  });

  it('never leaves anyone with no account type', () => {
    assert.deepEqual(
      availableModes(viewer({ profile: { passenger_enabled: false, drives_enabled: false } })),
      ['passenger'],
    );
  });
});

describe('toggleableModes', () => {
  it('lets nobody switch anything on from plain passenger', () => {
    assert.deepEqual(toggleableModes(viewer()), []);
  });

  it('lets an owner switch driving and passenger', () => {
    assert.deepEqual(
      toggleableModes(viewer({ memberships: [OWNER], profile: { passenger_enabled: false, drives_enabled: true } })),
      [
        { mode: 'driver', enabled: true },
        { mode: 'passenger', enabled: false },
      ],
    );
  });

  it('lets staff, drivers and admins switch passenger only', () => {
    for (const person of [
      viewer({ memberships: [STAFF] }),
      viewer({ memberships: [DRIVER] }),
      viewer({ isAdmin: true }),
    ]) {
      assert.deepEqual(toggleableModes(person), [{ mode: 'passenger', enabled: true }]);
    }
  });
});

describe('resolveMode', () => {
  const both = viewer({ memberships: [OWNER], profile: { passenger_enabled: true, drives_enabled: false } });

  it('keeps a chosen type the person still has', () => {
    assert.equal(resolveMode(both, 'passenger'), 'passenger');
  });

  it('asks when there is a choice and nothing valid was chosen', () => {
    assert.equal(resolveMode(both, undefined), null);
    assert.equal(resolveMode(both, 'admin'), null, 'a type they do not have is ignored');
    assert.equal(resolveMode(both, 'nonsense'), null);
  });

  it('needs no choice from someone with one type', () => {
    assert.equal(resolveMode(viewer(), undefined), 'passenger');
    assert.equal(resolveMode(viewer(), 'operator'), 'passenger');
  });
});

describe('paths', () => {
  it('knows which sections belong to which type', () => {
    assert.equal(modeForPath('/admin/cities'), 'admin');
    assert.equal(modeForPath('/operator/op-1/bookings?status=waiting'), 'operator');
    assert.equal(modeForPath('/driver'), 'driver');
    assert.equal(modeForPath('/my-rides/history'), 'passenger');
    assert.equal(modeForPath('/profile'), null);
    assert.equal(modeForPath('/administrators'), null, 'a prefix match is not a section');
  });

  it('starts each type at its own home', () => {
    const person = viewer({ isAdmin: true, memberships: [DRIVER, STAFF] });
    assert.equal(homeFor(person, 'admin'), '/admin');
    assert.equal(homeFor(person, 'operator'), '/operator/op-2');
    assert.equal(homeFor(person, 'driver'), '/driver');
    assert.equal(homeFor(person, 'passenger'), '/');
  });

  it('returns to where they were headed only if it fits the type they chose', () => {
    const person = viewer({ memberships: [OWNER] });
    assert.equal(destinationFor(person, 'operator', '/operator/op-1/fleet'), '/operator/op-1/fleet');
    assert.equal(destinationFor(person, 'passenger', '/operator/op-1/fleet'), '/');
    assert.equal(destinationFor(person, 'operator', '/profile'), '/profile');
    assert.equal(destinationFor(person, 'operator', '/'), '/operator/op-1');
    assert.equal(destinationFor(person, 'operator', '//evil.example'), '/operator/op-1');
  });
});
