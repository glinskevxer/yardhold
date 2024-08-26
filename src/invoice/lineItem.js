import { ValidationError } from '../core/errors.js';
import { optional, requireInteger, requireOneOf, requireString } from '../core/guards.js';
import { add, formatMoney, times } from '../core/money.js';
import { formatCivilDate, parseCivilDate } from '../time/civil.js';

/**
 * One line on an invoice.
 *
 * Every line names the car it came from and the day it was earned, because the
 * first thing a consignee does with a demurrage invoice is ask which car, and
 * the second is ask which day. A line that cannot answer both is a line that
 * will be disputed and won.
 */

export const CHARGE_TYPE = Object.freeze({
  DEMURRAGE: 'demurrage',
  STORAGE: 'storage',
  SWITCHING: 'switching',
  CAR_HIRE: 'car-hire',
  ADJUSTMENT: 'adjustment',
  CREDIT: 'credit',
});

const TYPES = Object.values(CHARGE_TYPE);

export function lineItem({
  type,
  carId,
  date,
  quantity = 1,
  unitAmount,
  description,
  dayIndex,
  reference,
  taxable = false,
} = {}) {
  requireOneOf(type, TYPES, 'type');
  requireInteger(quantity, 'quantity', { min: 1, max: 1000 });
  if (!Number.isInteger(unitAmount)) {
    throw new ValidationError('a line item needs a whole cent unit amount', { type, unitAmount });
  }
  if (type !== CHARGE_TYPE.CREDIT && type !== CHARGE_TYPE.ADJUSTMENT && unitAmount < 0) {
    throw new ValidationError('only a credit or an adjustment can be negative', { type });
  }
  return Object.freeze({
    type,
    carId: optional(carId, (value) => requireString(value, 'carId')),
    date: date === undefined ? undefined : formatCivilDate(parseCivilDate(String(date))),
    quantity,
    unitAmount,
    amount: times(unitAmount, quantity),
    description:
      description === undefined
        ? defaultDescription(type)
        : requireString(description, 'description'),
    dayIndex: optional(dayIndex, (value) => requireInteger(value, 'dayIndex', { min: 1 })),
    reference: optional(reference, (value) => requireString(value, 'reference')),
    taxable: taxable === true,
  });
}

function defaultDescription(type) {
  switch (type) {
    case CHARGE_TYPE.DEMURRAGE:
      return 'demurrage';
    case CHARGE_TYPE.STORAGE:
      return 'private car storage';
    case CHARGE_TYPE.SWITCHING:
      return 'switching';
    case CHARGE_TYPE.CAR_HIRE:
      return 'car hire';
    case CHARGE_TYPE.CREDIT:
      return 'credit';
    default:
      return 'adjustment';
  }
}

export function lineTotal(lines) {
  return add(...lines.map((line) => line.amount));
}

export function linesOfType(lines, type) {
  return lines.filter((line) => line.type === type);
}

export function linesForCar(lines, carId) {
  return lines.filter((line) => line.carId === carId);
}

export function subtotalsByType(lines) {
  const totals = new Map();
  for (const line of lines) {
    totals.set(line.type, add(totals.get(line.type) ?? 0, line.amount));
  }
  return Object.fromEntries([...totals.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function taxableTotal(lines) {
  return lineTotal(lines.filter((line) => line.taxable));
}

export function describeLine(line) {
  const car = line.carId === undefined ? '' : `${line.carId} `;
  const day = line.date === undefined ? '' : `${line.date} `;
  return `${car}${day}${line.description} ${formatMoney(line.amount)}`;
}
