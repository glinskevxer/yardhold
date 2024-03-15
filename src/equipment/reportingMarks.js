import { ValidationError } from '../core/errors.js';
import { requireString } from '../core/guards.js';

/**
 * Reporting marks and car numbers.
 *
 * A mark is two to four letters. A mark ending in X belongs to a private owner
 * rather than a railroad, and that single letter decides which book the car is
 * billed under: railroad cars take demurrage, private cars take storage. The
 * distinction is load bearing everywhere downstream, so it is settled here.
 */

const MARK_PATTERN = /^[A-Z]{2,4}$/;
const MAX_CAR_NUMBER = 999999;

export function reportingMark(text) {
  const value = requireString(text, 'mark').trim().toUpperCase();
  if (!MARK_PATTERN.test(value)) {
    throw new ValidationError('a reporting mark is two to four letters', { text });
  }
  return value;
}

export function isPrivateMark(mark) {
  return reportingMark(mark).endsWith('X');
}

export function isRailroadMark(mark) {
  return !isPrivateMark(mark);
}

export function carNumber(value) {
  const numeric = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > MAX_CAR_NUMBER) {
    throw new ValidationError('a car number is one to six digits', { value });
  }
  return numeric;
}

export function carInitialAndNumber(text) {
  requireString(text, 'car');
  const match = /^\s*([A-Za-z]{2,4})\s*[- ]?\s*(\d{1,6})\s*$/.exec(text);
  if (!match) {
    throw new ValidationError('a car id is a reporting mark then a number', { text });
  }
  return { mark: reportingMark(match[1]), number: carNumber(match[2]) };
}

export function formatCarId({ mark, number }) {
  return `${reportingMark(mark)} ${carNumber(number)}`;
}

export function normalizeCarId(text) {
  return formatCarId(carInitialAndNumber(text));
}

/**
 * The AAR check digit over the mark and number. Letters are weighted by their
 * position in the alphabet, which is how the wayside readers report them.
 */
export function checkDigit(text) {
  const { mark, number } = carInitialAndNumber(text);
  const letters = mark.split('').map((letter) => letter.charCodeAt(0) - 64);
  const digits = String(number)
    .padStart(6, '0')
    .split('')
    .map((digit) => Number(digit));
  const stream = [...letters, ...digits];
  let sum = 0;
  for (let index = 0; index < stream.length; index += 1) {
    const weight = index % 2 === 0 ? 2 : 1;
    const product = stream[stream.length - 1 - index] * weight;
    sum += product > 9 ? product - 9 : product;
  }
  return (10 - (sum % 10)) % 10;
}

export function sameCar(left, right) {
  return normalizeCarId(left) === normalizeCarId(right);
}

export function compareCarIds(left, right) {
  const a = carInitialAndNumber(left);
  const b = carInitialAndNumber(right);
  if (a.mark !== b.mark) {
    return a.mark < b.mark ? -1 : 1;
  }
  return a.number - b.number;
}
