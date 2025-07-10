import { ValidationError } from '../core/errors.js';
import { optional, requireOneOf, requireString } from '../core/guards.js';
import { parseMoney } from '../core/money.js';
import { parseInstant } from '../time/instant.js';
import { normalizeCarId } from '../equipment/reportingMarks.js';
import { DEFAULT_OFFSET_MINUTES } from '../time/instant.js';

/**
 * Diversion and reconsignment.
 *
 * The two words get used interchangeably in the yard and they are not the same
 * thing. A car changed before it reaches its billed destination is diverted; a
 * car changed after it arrives is reconsigned. The distinction decides what
 * happens to the clock:
 *
 *   diverted before placement    the car never arrived, so nothing accrued
 *   reconsigned after placement  the car did arrive, and the free time it has
 *                                already burned stays burned
 *
 * A consignee who reconsigns on the fourth day and expects a fresh allowance is
 * asking for the first rule while doing the second thing.
 */

export const CHANGE = Object.freeze({
  DIVERSION: 'diversion',
  RECONSIGNMENT: 'reconsignment',
});

const CHANGES = Object.values(CHANGE);

export function routeChange({
  carId,
  kind,
  orderedAt,
  offsetMinutes = DEFAULT_OFFSET_MINUTES,
  fromSplc,
  toSplc,
  fromConsigneeId,
  toConsigneeId,
  orderedBy,
  charge = '0.00',
  placedBeforeChange = false,
} = {}) {
  const car = normalizeCarId(requireString(carId, 'carId'));
  requireOneOf(kind, CHANGES, 'kind');
  const at =
    typeof orderedAt === 'number'
      ? orderedAt
      : parseInstant(requireString(orderedAt, 'orderedAt'), offsetMinutes);
  requireString(toSplc, 'toSplc');
  if (fromSplc !== undefined && fromSplc === toSplc && toConsigneeId === undefined) {
    throw new ValidationError('a route change has to change something', { carId: car });
  }
  const placed = placedBeforeChange === true;
  if (kind === CHANGE.DIVERSION && placed) {
    throw new ValidationError('a car that was already placed is reconsigned, not diverted', {
      carId: car,
    });
  }
  if (kind === CHANGE.RECONSIGNMENT && !placed) {
    throw new ValidationError('a car that was never placed is diverted, not reconsigned', {
      carId: car,
    });
  }
  return Object.freeze({
    carId: car,
    kind,
    orderedAt: at,
    offsetMinutes,
    fromSplc: optional(fromSplc, (value) => requireString(value, 'fromSplc')),
    toSplc,
    fromConsigneeId: optional(fromConsigneeId, (value) =>
      requireString(value, 'fromConsigneeId').toUpperCase()
    ),
    toConsigneeId: optional(toConsigneeId, (value) =>
      requireString(value, 'toConsigneeId').toUpperCase()
    ),
    orderedBy: optional(orderedBy, (value) => requireString(value, 'orderedBy')),
    charge: parseMoney(String(charge)),
    placedBeforeChange: placed,
  });
}

/** Does the free time already spent survive the change. */
export function resetsFreeTime(record) {
  return record.kind === CHANGE.DIVERSION;
}

export function carriesFreeTimeForward(record) {
  return record.kind === CHANGE.RECONSIGNMENT;
}

export function changesConsignee(record) {
  return record.toConsigneeId !== undefined && record.toConsigneeId !== record.fromConsigneeId;
}

export function changesStation(record) {
  return record.fromSplc !== undefined && record.fromSplc !== record.toSplc;
}

export function applyToAllowance(record, { allowance, alreadySpent }) {
  if (resetsFreeTime(record)) {
    return { allowance, spent: 0 };
  }
  return { allowance, spent: Math.min(alreadySpent, allowance) };
}

export function changesForCar(records, carId) {
  const wanted = normalizeCarId(carId);
  return records
    .filter((record) => record.carId === wanted)
    .sort((a, b) => a.orderedAt - b.orderedAt);
}

export function totalChangeCharges(records) {
  return records.reduce((sum, record) => sum + record.charge, 0);
}

export function describeChange(record) {
  const where =
    record.fromSplc === undefined ? record.toSplc : `${record.fromSplc} to ${record.toSplc}`;
  return `${record.carId} ${record.kind} ${where}`;
}
