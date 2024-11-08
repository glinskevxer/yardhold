import { ValidationError } from '../core/errors.js';
import { requireInteger, requireOneOf, requireString } from '../core/guards.js';
import { add, parseMoney, scale, times } from '../core/money.js';
import { parseQuantity, quantity, toNumber } from '../core/quantity.js';

/**
 * Car hire, which everyone still calls per diem.
 *
 * Two ways to price it and they are not variants of each other:
 *
 *   straight        a flat rate for every day the car was on the line
 *   time-mileage    an hourly rate for the time plus a rate for every loaded
 *                   mile, and the hourly part stops accruing once the car has
 *                   run far enough that the mileage is carrying the charge
 *
 * The second one is why a car that sat for a week and moved eighty miles can
 * cost less than one that sat for two days and never moved.
 */

export const HIRE_BASIS = Object.freeze({
  STRAIGHT: 'straight',
  TIME_MILEAGE: 'time-mileage',
});

const BASES = Object.values(HIRE_BASIS);

export function hireRate({
  carKind,
  basis = HIRE_BASIS.TIME_MILEAGE,
  dailyRate = '0.00',
  hourlyRate = '0.0000',
  mileageRate = '0.0000',
  freeRunningHours = 0,
} = {}) {
  requireString(carKind, 'carKind');
  requireOneOf(basis, BASES, 'basis');
  requireInteger(freeRunningHours, 'freeRunningHours', { min: 0, max: 240 });
  const daily = parseMoney(String(dailyRate));
  const hourly = parseQuantity(String(hourlyRate), 4);
  const mileage = parseQuantity(String(mileageRate), 4);
  if (daily < 0 || hourly.units < 0 || mileage.units < 0) {
    throw new ValidationError('a hire rate cannot be negative', { carKind });
  }
  if (basis === HIRE_BASIS.STRAIGHT && daily === 0) {
    throw new ValidationError('a straight hire rate needs a daily rate', { carKind });
  }
  return Object.freeze({
    carKind,
    basis,
    dailyRate: daily,
    hourlyRate: hourly,
    mileageRate: mileage,
    freeRunningHours,
  });
}

export function hireBook(rates = []) {
  const byKind = new Map();
  for (const entry of rates) {
    const built = Object.isFrozen(entry) && entry.basis ? entry : hireRate(entry);
    byKind.set(built.carKind, built);
  }
  return {
    get size() {
      return byKind.size;
    },
    find(carKind) {
      return byKind.get(carKind);
    },
    kinds() {
      return [...byKind.keys()].sort();
    },
  };
}

function centsFromQuantity(rate, count) {
  return Math.round(toNumber(rate) * count * 100);
}

export function hireCharge(rate, { hours = 0, loadedMiles = 0, days } = {}) {
  requireInteger(hours, 'hours', { min: 0 });
  const miles = typeof loadedMiles === 'number' ? quantity(loadedMiles, 0) : loadedMiles;
  if (rate.basis === HIRE_BASIS.STRAIGHT) {
    const wholeDays =
      days === undefined ? Math.ceil(hours / 24) : requireInteger(days, 'days', { min: 0 });
    return {
      basis: rate.basis,
      timeCharge: times(rate.dailyRate, wholeDays),
      mileageCharge: 0,
      total: times(rate.dailyRate, wholeDays),
      chargedHours: wholeDays * 24,
      chargedMiles: 0,
    };
  }
  const chargedHours = Math.max(0, hours - rate.freeRunningHours);
  const timeCharge = centsFromQuantity(rate.hourlyRate, chargedHours);
  const mileageCharge = centsFromQuantity(rate.mileageRate, miles.units);
  return {
    basis: rate.basis,
    timeCharge,
    mileageCharge,
    total: add(timeCharge, mileageCharge),
    chargedHours,
    chargedMiles: miles.units,
  };
}

export function prorateHire(charge, numerator, denominator) {
  return scale(charge.total, numerator, denominator);
}

export function describeHire(charge) {
  return `${charge.basis} time ${charge.timeCharge} mileage ${charge.mileageCharge}`;
}
