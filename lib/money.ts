/**
 * Money is integer cents, everywhere, always. `4500` is $45.00.
 *
 * Nothing in this file returns a float, and nothing accepts one. The only
 * place a decimal exists is the string an operator types into a price box, and
 * it is converted to cents before it goes anywhere else.
 */

const currency = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  minimumFractionDigits: 2,
});

/** 4500 → "$45.00" */
export function formatCents(cents: number): string {
  return currency.format(cents / 100);
}

/** 4500 → "45.00", for prefilling a price input. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * "45", "45.5", "$45.50", "1,045.50" → cents.
 *
 * Parsed digit by digit rather than through `parseFloat`, because
 * `Math.round(19.99 * 100)` is one of the classic ways money goes wrong.
 * Returns null on anything that is not a plain dollar amount.
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const [whole = '0', fraction = ''] = cleaned.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}
