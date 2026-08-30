/**
 * How strong a password looks, for the meter under the field.
 *
 * This is a suggestion, not a gate. The only rule that rejects anything is the
 * eight-character minimum in `lib/validation/auth.ts`; everything below simply
 * tells someone whether the thing they just typed is worth keeping. That is
 * why there is no dependency here — `zxcvbn` and friends ship a dictionary
 * measured in hundreds of kilobytes to answer a question we are not enforcing.
 *
 * Pure and side-effect free, so it runs unchanged in the browser as you type
 * and on the server if we ever want to log strength distribution.
 */

export const MIN_PASSWORD_LENGTH = 8;

export type StrengthScore = 0 | 1 | 2 | 3;

export type Strength = {
  score: StrengthScore;
  /** Shown beside the field. Written for the person typing, not for a log. */
  label: string;
};

/**
 * The passwords that turn up first in every credential-stuffing list. Short on
 * purpose: a long list is a dictionary, and a dictionary is the dependency we
 * are avoiding. These exist to stop the meter calling `password1` "medium"
 * just because it has a digit in it.
 */
const COMMON = new Set([
  'password',
  'passw0rd',
  'letmein',
  'welcome',
  'qwerty',
  'qwertyuiop',
  'iloveyou',
  'admin',
  'monkey',
  'dragon',
  'football',
  'baseball',
  'sunshine',
  'princess',
  'superman',
  'trustno',
  'abc',
  'abcabc',
  'test',
  'changeme',
  'corridor',
  'toronto',
  'windsor',
  'canada',
]);

/** Rows a finger walks along without thinking. */
const RUNS = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

const LABELS: Record<StrengthScore, string> = {
  0: 'Too short',
  1: 'Weak',
  2: 'Medium',
  3: 'Strong',
};

/**
 * @param personal Things the password should not be built out of — their name,
 *   the email they are signing up with, their phone number. An email is
 *   reduced to its local part, and each entry is split on punctuation, so
 *   passing `'Arman Sakif'` catches a password containing either half.
 */
export function scorePassword(password: string, personal: string[] = []): Strength {
  if (password.length < MIN_PASSWORD_LENGTH) return { score: 0, label: LABELS[0] };

  const lower = password.toLowerCase();

  let points = lengthPoints(password.length) + varietyPoints(password);

  // Penalties do not subtract, they cap. A twenty-character string of the same
  // letter is not "nearly strong with a deduction" — it is weak, and saying
  // otherwise is the one thing a meter must not do.
  if (isCommon(lower) || isSingleCharacter(lower) || hasRun(lower) || echoesPersonal(lower, personal)) {
    points = Math.min(points, 2);
  }

  if (points <= 2) return { score: 1, label: LABELS[1] };
  if (points <= 4) return { score: 2, label: LABELS[2] };
  return { score: 3, label: LABELS[3] };
}

function lengthPoints(length: number): number {
  if (length >= 20) return 4;
  if (length >= 16) return 3;
  if (length >= 12) return 2;
  return 1;
}

/** One point per character class beyond the first: mixed input is harder to guess. */
function varietyPoints(password: string): number {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((re) => re.test(password)).length;
  return Math.max(0, classes - 1);
}

/**
 * Matches the word underneath the decoration too, so `Password1!` is caught by
 * the same entry that catches `password`.
 */
function isCommon(lower: string): boolean {
  const stripped = lower.replace(/[^a-z]/g, '');
  return COMMON.has(lower) || COMMON.has(stripped);
}

function isSingleCharacter(lower: string): boolean {
  return new Set(lower).size === 1;
}

/** Four or more characters walked in order, forwards or backwards, in any row. */
function hasRun(lower: string): boolean {
  for (const row of RUNS) {
    const reversed = [...row].reverse().join('');
    for (let i = 0; i + 4 <= row.length; i += 1) {
      if (lower.includes(row.slice(i, i + 4))) return true;
      if (lower.includes(reversed.slice(i, i + 4))) return true;
    }
  }
  return false;
}

/**
 * A password built from their own name or email is weak against exactly the
 * person most likely to try guessing it.
 */
function echoesPersonal(lower: string, personal: string[]): boolean {
  for (const entry of personal) {
    const local = entry.toLowerCase().split('@')[0] ?? '';
    for (const fragment of local.split(/[^a-z0-9]+/)) {
      if (fragment.length >= 4 && lower.includes(fragment)) return true;
    }
  }
  return false;
}
