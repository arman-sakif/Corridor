import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MIN_PASSWORD_LENGTH, scorePassword } from './password-strength.ts';

describe('scorePassword', () => {
  it('calls anything under the minimum too short, whatever else it contains', () => {
    assert.deepEqual(scorePassword('Xk9#mQ'), { score: 0, label: 'Too short' });
    assert.equal(scorePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1)).score, 0);
    assert.notEqual(scorePassword('a'.repeat(MIN_PASSWORD_LENGTH)).score, 0);
  });

  it('rates a long mixed password strong', () => {
    assert.deepEqual(scorePassword('Xk9#mQ2pLw4$'), { score: 3, label: 'Strong' });
    assert.equal(scorePassword('correct-horse-battery-staple').score, 3);
  });

  it('rates a short mixed password medium', () => {
    assert.deepEqual(scorePassword('Tr0ub4dor&3'), { score: 2, label: 'Medium' });
  });

  it('keeps a common password weak however it is decorated', () => {
    assert.equal(scorePassword('password').score, 1);
    assert.equal(scorePassword('Password1!').score, 1);
    assert.equal(scorePassword('Qwerty123!').score, 1);
  });

  it('sees through length made of one repeated character', () => {
    assert.deepEqual(scorePassword('aaaaaaaaaaaaaaaaaaaa'), { score: 1, label: 'Weak' });
  });

  it('sees through a walk along the keyboard', () => {
    assert.equal(scorePassword('abcdefghij').score, 1);
    assert.equal(scorePassword('asdfghjkl1').score, 1);
    assert.equal(scorePassword('Zz!987654321').score, 1);
  });

  it('downgrades a password built from the name or email you just typed', () => {
    const personal = ['Arman Sakif', 'arman.sakif@example.com'];
    assert.equal(scorePassword('ArmanSakif2024!', personal).score, 1);
    assert.equal(scorePassword('ArmanSakif2024!').score, 3, 'strong to a stranger');
  });

  it('ignores personal fragments too short to mean anything', () => {
    assert.equal(scorePassword('Xk9#mQ2pLw4$', ['Al', 'a@b.com']).score, 3);
  });
});
