import { NotFoundError, ValidationError } from '../core/errors.js';
import { requireArray, requireInteger, requireOneOf } from '../core/guards.js';
import { add, parseMoney, times } from '../core/money.js';

/**
 * Ancillary services.
 *
 * Heating is the interesting one. A tank car of phenol has to be steamed before
 * it will move, so the service is not optional and the plant is charged for it;
 * a boxcar cannot be steamed at all and an order to do so is refused rather
 * than billed at zero. So the car and the commodity together decide whether the
 * order is even admissible, and only then does the rate matter.
 */

export const SERVICE_KIND = Object.freeze({
  HEATING: 'heating',
  WEIGHING: 'weighing',
  CLEANING: 'cleaning',
  BLOCKING: 'blocking',
  HOLD_FOR_ORDERS: 'hold-for-orders',
});

const KINDS = Object.values(SERVICE_KIND);

const ELIGIBLE_CAR_KINDS = Object.freeze({
  [SERVICE_KIND.HEATING]: ['tank'],
  [SERVICE_KIND.CLEANING]: ['tank', 'hopper', 'gondola'],
  [SERVICE_KIND.WEIGHING]: ['tank', 'hopper', 'gondola', 'boxcar', 'flatcar', 'refrigerated'],
  [SERVICE_KIND.BLOCKING]: ['flatcar', 'gondola'],
  [SERVICE_KIND.HOLD_FOR_ORDERS]: [
    'tank',
    'hopper',
    'gondola',
    'boxcar',
    'flatcar',
    'refrigerated',
  ],
});

export const REFUSAL = Object.freeze({
  WRONG_CAR: 'wrong-car-kind',
  NOT_REQUIRED: 'not-required-by-the-commodity',
  NO_RATE: 'no-rate-filed',
});

export function serviceRate({ kind, rate, perHour = false, minimumUnits = 1 } = {}) {
  requireOneOf(kind, KINDS, 'kind');
  requireInteger(minimumUnits, 'minimumUnits', { min: 1, max: 100 });
  const amount = parseMoney(String(rate));
  if (amount < 0) {
    throw new ValidationError('a service rate cannot be negative', { kind });
  }
  return Object.freeze({ kind, rate: amount, perHour: perHour === true, minimumUnits });
}

export function serviceBook(rates = []) {
  const byKind = new Map();
  for (const entry of requireArray(rates, 'rates')) {
    const built = typeof entry.rate === 'number' ? entry : serviceRate(entry);
    byKind.set(built.kind, built);
  }
  return {
    get size() {
      return byKind.size;
    },
    find(kind) {
      return byKind.get(kind);
    },
    rateFor(kind) {
      const found = byKind.get(kind);
      if (found === undefined) {
        throw new NotFoundError('service rate', kind);
      }
      return found;
    },
    kinds() {
      return [...byKind.keys()].sort();
    },
  };
}

export function isAdmissible(kind, { carKind, commodity } = {}) {
  requireOneOf(kind, KINDS, 'kind');
  const allowed = ELIGIBLE_CAR_KINDS[kind] ?? [];
  if (carKind !== undefined && !allowed.includes(carKind)) {
    return { admissible: false, refusal: REFUSAL.WRONG_CAR };
  }
  if (kind === SERVICE_KIND.HEATING && commodity !== undefined && !commodity.requiresHeat) {
    return { admissible: false, refusal: REFUSAL.NOT_REQUIRED };
  }
  return { admissible: true };
}

export function chargeService(kind, book, { carKind, commodity, units = 1 } = {}) {
  requireInteger(units, 'units', { min: 1, max: 1000 });
  const verdict = isAdmissible(kind, { carKind, commodity });
  if (!verdict.admissible) {
    return { kind, amount: 0, billed: false, refusal: verdict.refusal, units: 0 };
  }
  const rate = book.find(kind);
  if (rate === undefined) {
    return { kind, amount: 0, billed: false, refusal: REFUSAL.NO_RATE, units: 0 };
  }
  const billedUnits = Math.max(units, rate.minimumUnits);
  return {
    kind,
    amount: times(rate.rate, billedUnits),
    billed: true,
    units: billedUnits,
    perHour: rate.perHour,
  };
}

export function chargeAll(orders, book) {
  const lines = orders.map((order) => chargeService(order.kind, book, order));
  return { lines, total: add(...lines.map((line) => line.amount)) };
}

export const STANDARD_SERVICE_RATES = Object.freeze([
  { kind: SERVICE_KIND.HEATING, rate: '145.00', perHour: true, minimumUnits: 4 },
  { kind: SERVICE_KIND.WEIGHING, rate: '95.00' },
  { kind: SERVICE_KIND.CLEANING, rate: '620.00' },
  { kind: SERVICE_KIND.BLOCKING, rate: '210.00' },
]);
