import { ValidationError } from '../core/errors.js';
import { optional, requireArray, requireString } from '../core/guards.js';
import { referenceNumber } from '../core/ids.js';
import { add, allocateByWeight } from '../core/money.js';
import { formatCivilDate, parseCivilDate } from '../time/civil.js';

/**
 * Credit memos.
 *
 * A credit is raised against an invoice, never against a car, because the
 * invoice is what the consignee is holding. It still has to be spread over the
 * cars, though, since a later claim on one of them has to know how much of it
 * has already been given back. The spread is by the weight each car carried on
 * the original invoice, and it foots exactly.
 */

export function creditMemo({
  sequence,
  period,
  invoiceNumber,
  consigneeId,
  amount,
  reason,
  claimNumber,
  issuedOn,
  allocations = [],
} = {}) {
  requireString(period, 'period');
  requireString(invoiceNumber, 'invoiceNumber');
  requireString(consigneeId, 'consigneeId');
  requireString(reason, 'reason');
  requireArray(allocations, 'allocations');
  const issued = parseCivilDate(requireString(issuedOn, 'issuedOn'));
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ValidationError('a credit memo is a whole cent amount above zero', { invoiceNumber });
  }
  const allocated = add(...allocations.map((entry) => entry.amount));
  if (allocations.length > 0 && allocated !== amount) {
    throw new ValidationError('the allocations do not foot to the memo', {
      invoiceNumber,
      amount,
      allocated,
    });
  }
  return Object.freeze({
    number: referenceNumber('CRM', period, sequence),
    period,
    invoiceNumber,
    consigneeId: consigneeId.trim().toUpperCase(),
    amount,
    reason,
    claimNumber: optional(claimNumber, (value) => requireString(value, 'claimNumber')),
    issuedOn: formatCivilDate(issued),
    allocations: Object.freeze([...allocations]),
  });
}

/** Spread a credit over the cars in proportion to what each was billed. */
export function allocateOverCars(amount, invoiceLines) {
  const byCar = new Map();
  for (const line of invoiceLines) {
    if (line.carId === undefined || line.amount <= 0) {
      continue;
    }
    byCar.set(line.carId, (byCar.get(line.carId) ?? 0) + line.amount);
  }
  const cars = [...byCar.keys()].sort();
  if (cars.length === 0) {
    return [];
  }
  const shares = allocateByWeight(
    amount,
    cars.map((carId) => byCar.get(carId))
  );
  return cars.map((carId, index) => ({ carId, amount: shares[index] }));
}

export function memoFor(record, carId) {
  return record.allocations.find((entry) => entry.carId === carId)?.amount ?? 0;
}

export function totalCredited(memos, invoiceNumber) {
  return memos
    .filter((record) => invoiceNumber === undefined || record.invoiceNumber === invoiceNumber)
    .reduce((sum, record) => sum + record.amount, 0);
}

export function creditedForCar(memos, carId) {
  return memos.reduce((sum, record) => sum + memoFor(record, carId), 0);
}

export function remainingOn(invoiceTotal, memos, invoiceNumber) {
  return Math.max(0, invoiceTotal - totalCredited(memos, invoiceNumber));
}

export function describeMemo(record) {
  const claim = record.claimNumber === undefined ? '' : ` on ${record.claimNumber}`;
  return `${record.number} against ${record.invoiceNumber}${claim} for ${record.amount}`;
}
