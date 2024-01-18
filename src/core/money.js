import { ValidationError } from './errors.js';

/**
 * Money is an integer number of cents. Nothing in this codebase ever holds a
 * dollar amount in a float, because a demurrage invoice is footed against the
 * carrier's own and a half cent of drift turns into a dispute.
 */

const CENTS_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export function fromCents(cents) {
  if (!Number.isInteger(cents)) {
    throw new ValidationError('money must be a whole number of cents', { cents });
  }
  return cents;
}

export function fromDollars(dollars) {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars)) {
    throw new ValidationError('dollar amount must be a finite number', { dollars });
  }
  return Math.round(dollars * 100);
}

export function parseMoney(text) {
  if (typeof text !== 'string') {
    throw new ValidationError('money literal must be a string', { text });
  }
  const trimmed = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!CENTS_PATTERN.test(trimmed)) {
    throw new ValidationError('money literal is not a plain decimal amount', { text });
  }
  const negative = trimmed.startsWith('-');
  const [whole, frac = ''] = trimmed.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return negative ? -cents : cents;
}

export function add(...amounts) {
  return amounts.reduce((sum, amount) => sum + fromCents(amount), 0);
}

export function subtract(left, right) {
  return fromCents(left) - fromCents(right);
}

export function negate(amount) {
  return -fromCents(amount);
}

export function abs(amount) {
  return Math.abs(fromCents(amount));
}

/** Multiply by a whole count. Used for "rate times chargeable days". */
export function times(amount, count) {
  if (!Number.isInteger(count)) {
    throw new ValidationError('money can only be multiplied by a whole count', { count });
  }
  return fromCents(amount) * count;
}

/**
 * Multiply by a ratio expressed as a numerator and denominator, rounding half
 * away from zero. Half up would bias every proration toward the carrier.
 */
export function scale(amount, numerator, denominator) {
  if (denominator === 0) {
    throw new ValidationError('cannot scale money by a zero denominator', { numerator });
  }
  const product = fromCents(amount) * numerator;
  const quotient = product / denominator;
  return quotient < 0 ? -Math.round(-quotient) : Math.round(quotient);
}

/**
 * Split an amount into `parts` shares whose sum is exactly the original. The
 * remainder cents land on the earliest shares, which is how the carriers
 * proration tables read.
 */
export function allocate(amount, parts) {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new ValidationError('allocation needs at least one part', { parts });
  }
  const total = fromCents(amount);
  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);
  const base = Math.floor(magnitude / parts);
  let remainder = magnitude - base * parts;
  const shares = [];
  for (let index = 0; index < parts; index += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    shares.push(sign * (base + extra));
  }
  return shares;
}

/** Split by weights whose sum must be positive. Largest remainder wins. */
export function allocateByWeight(amount, weights) {
  if (!Array.isArray(weights) || weights.length === 0) {
    throw new ValidationError('allocation needs at least one weight', { weights });
  }
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    throw new ValidationError('allocation weights must sum to a positive number', { weights });
  }
  const total = fromCents(amount);
  const raw = weights.map((weight) => (total * weight) / totalWeight);
  const floors = raw.map((value) => Math.trunc(value));
  let leftover = total - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: Math.abs(value - floors[index]) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  const step = leftover < 0 ? -1 : 1;
  let cursor = 0;
  while (leftover !== 0 && order.length > 0) {
    floors[order[cursor % order.length].index] += step;
    leftover -= step;
    cursor += 1;
  }
  return floors;
}

export function compare(left, right) {
  const a = fromCents(left);
  const b = fromCents(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isZero(amount) {
  return fromCents(amount) === 0;
}

export function max(...amounts) {
  return amounts.map(fromCents).reduce((best, amount) => (amount > best ? amount : best));
}

export function min(...amounts) {
  return amounts.map(fromCents).reduce((best, amount) => (amount < best ? amount : best));
}

export function formatMoney(amount, { symbol = '$', grouping = true } = {}) {
  const cents = fromCents(amount);
  const negative = cents < 0;
  const magnitude = Math.abs(cents);
  const whole = String(Math.floor(magnitude / 100));
  const frac = String(magnitude % 100).padStart(2, '0');
  const grouped = grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
  return `${negative ? '-' : ''}${symbol}${grouped}.${frac}`;
}
