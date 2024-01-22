import { ValidationError } from './errors.js';

/**
 * A quantity is a fixed point number held as an integer of minor units plus a
 * scale. Rates come out of tariff pages with four decimals, weights come off
 * the scale in hundredweight with one, and mileage is whole miles. Keeping the
 * scale on the value stops a four decimal rate from silently being read as a
 * two decimal one.
 */

const MAX_SCALE = 8;

export function quantity(units, scale = 0) {
  if (!Number.isInteger(units)) {
    throw new ValidationError('quantity units must be a whole number', { units });
  }
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new ValidationError('quantity scale must be between 0 and 8', { scale });
  }
  return { units, scale };
}

export function parseQuantity(text, scale) {
  if (typeof text !== 'string') {
    throw new ValidationError('quantity literal must be a string', { text });
  }
  const trimmed = text.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new ValidationError('quantity literal is not a plain decimal', { text });
  }
  const negative = trimmed.startsWith('-');
  const [whole, frac = ''] = trimmed.replace('-', '').split('.');
  const target = scale === undefined ? frac.length : scale;
  if (scale !== undefined && frac.length > scale) {
    throw new ValidationError('quantity literal carries more precision than the scale allows', {
      text,
      scale,
    });
  }
  const padded = frac.padEnd(target, '0');
  const units = Number(whole) * 10 ** target + (padded === '' ? 0 : Number(padded));
  return quantity(negative ? -units : units, target);
}

export function rescale(value, scale) {
  const target = quantity(0, scale).scale;
  if (target === value.scale) {
    return value;
  }
  if (target > value.scale) {
    return quantity(value.units * 10 ** (target - value.scale), target);
  }
  const factor = 10 ** (value.scale - target);
  const quotient = value.units / factor;
  const rounded = quotient < 0 ? -Math.round(-quotient) : Math.round(quotient);
  return quantity(rounded, target);
}

function align(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return [rescale(left, scale), rescale(right, scale), scale];
}

export function addQuantity(left, right) {
  const [a, b, scale] = align(left, right);
  return quantity(a.units + b.units, scale);
}

export function subtractQuantity(left, right) {
  const [a, b, scale] = align(left, right);
  return quantity(a.units - b.units, scale);
}

export function multiplyQuantity(value, factor) {
  if (!Number.isInteger(factor)) {
    throw new ValidationError('a quantity can only be multiplied by a whole factor', { factor });
  }
  return quantity(value.units * factor, value.scale);
}

export function compareQuantity(left, right) {
  const [a, b] = align(left, right);
  return a.units < b.units ? -1 : a.units > b.units ? 1 : 0;
}

export function toNumber(value) {
  return value.units / 10 ** value.scale;
}

export function formatQuantity(value, { minScale = value.scale } = {}) {
  const shown = minScale > value.scale ? rescale(value, minScale) : value;
  const negative = shown.units < 0;
  const digits = String(Math.abs(shown.units)).padStart(shown.scale + 1, '0');
  const cut = digits.length - shown.scale;
  const whole = digits.slice(0, cut);
  const frac = digits.slice(cut);
  const body = shown.scale === 0 ? whole : `${whole}.${frac}`;
  return negative ? `-${body}` : body;
}

export const ZERO_MILES = quantity(0, 0);
export const ZERO_RATE = quantity(0, 4);
