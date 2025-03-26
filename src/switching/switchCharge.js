import { ValidationError } from '../core/errors.js';
import { requireInteger, requireString } from '../core/guards.js';
import { rateBook } from '../core/rateBook.js';
import { add, parseMoney, times } from '../core/money.js';
import { SWITCH_KIND, isBillable } from './switchOrder.js';

/**
 * Pricing the switches.
 *
 * The switch tariff is a flat rate per movement with one wrinkle that matters:
 * several cars moved in the same handling are one switch, not one each. So the
 * charge is per handling and the cars in it split nothing, which means the
 * grouping decides the bill far more than the rate does.
 */

export function switchRate({ kind, rate, perCar = false, minimumCars = 1 } = {}) {
  requireString(kind, 'kind');
  requireInteger(minimumCars, 'minimumCars', { min: 1, max: 50 });
  const amount = parseMoney(String(rate));
  if (amount < 0) {
    throw new ValidationError('a switch rate cannot be negative', { kind });
  }
  return Object.freeze({ kind, rate: amount, perCar: perCar === true, minimumCars });
}

export function switchTariff(rates = []) {
  const book = rateBook({
    label: 'switch rate',
    rates,
    keyOf: (entry) => entry.kind,
    build: (entry) => (typeof entry.rate === 'number' ? entry : switchRate(entry)),
  });
  return {
    get size() {
      return book.size;
    },
    find: book.find,
    rateFor: book.rateFor,
    kinds: book.keys,
  };
}

/** A handling is every billable order of one kind moved at the same minute. */
export function groupHandlings(orders) {
  const groups = new Map();
  for (const order of orders.filter(isBillable)) {
    const key = `${order.kind}|${order.at}`;
    const list = groups.get(key);
    if (list) {
      list.push(order);
    } else {
      groups.set(key, [order]);
    }
  }
  return [...groups.values()].sort((a, b) => a[0].at - b[0].at || (a[0].kind < b[0].kind ? -1 : 1));
}

export function chargeSwitches(orders, tariffOfSwitches) {
  const lines = [];
  for (const handling of groupHandlings(orders)) {
    const rate = tariffOfSwitches.find(handling[0].kind);
    if (rate === undefined) {
      continue;
    }
    const cars = handling.map((order) => order.carId);
    const billedCars = Math.max(cars.length, rate.minimumCars);
    lines.push({
      kind: handling[0].kind,
      at: handling[0].at,
      cars,
      carCount: cars.length,
      billedCars: rate.perCar ? billedCars : 1,
      amount: rate.perCar ? times(rate.rate, billedCars) : rate.rate,
    });
  }
  return { lines, total: add(...lines.map((line) => line.amount)) };
}

export function switchTotal(result) {
  return result.total;
}

export const STANDARD_SWITCH_RATES = Object.freeze([
  { kind: SWITCH_KIND.INTRA_PLANT, rate: '340.00' },
  { kind: SWITCH_KIND.RECIPROCAL, rate: '425.00' },
  { kind: SWITCH_KIND.WEIGH, rate: '95.00', perCar: true },
]);
