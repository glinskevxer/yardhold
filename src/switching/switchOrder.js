import { ValidationError } from '../core/errors.js';
import { optional, requireOneOf, requireString } from '../core/guards.js';
import { fingerprint } from '../core/ids.js';
import { parseInstant } from '../time/instant.js';
import { normalizeCarId } from '../equipment/reportingMarks.js';

/**
 * Switch orders.
 *
 * A switch the consignee asked for is billable. A switch the carrier had to
 * make for its own convenience is not, and a switch that had to be repeated
 * because the plant was not ready is billable twice over. So the reason a move
 * happened decides whether it is a charge, and the reason is a field on the
 * order rather than something inferred from the movement.
 */

export const SWITCH_KIND = Object.freeze({
  PLACEMENT: 'placement',
  PULL: 'pull',
  INTRA_PLANT: 'intra-plant',
  RECIPROCAL: 'reciprocal',
  WEIGH: 'weigh',
});

const KINDS = Object.values(SWITCH_KIND);

export const SWITCH_REASON = Object.freeze({
  CUSTOMER_REQUEST: 'customer-request',
  CARRIER_CONVENIENCE: 'carrier-convenience',
  REFUSED_SPOT: 'refused-spot',
  BAD_ORDER: 'bad-order',
});

const REASONS = Object.values(SWITCH_REASON);

const BILLABLE_REASONS = new Set([SWITCH_REASON.CUSTOMER_REQUEST, SWITCH_REASON.REFUSED_SPOT]);

export function switchOrder({
  carId,
  kind,
  reason = SWITCH_REASON.CUSTOMER_REQUEST,
  at,
  offsetMinutes = -360,
  fromTrackId,
  toTrackId,
  consigneeId,
  orderedBy,
  completed = true,
} = {}) {
  const car = normalizeCarId(requireString(carId, 'carId'));
  requireOneOf(kind, KINDS, 'kind');
  requireOneOf(reason, REASONS, 'reason');
  const moment = typeof at === 'number' ? at : parseInstant(requireString(at, 'at'), offsetMinutes);
  if (kind === SWITCH_KIND.INTRA_PLANT && (fromTrackId === undefined || toTrackId === undefined)) {
    throw new ValidationError('an intra plant switch has to name both tracks', { carId: car });
  }
  if (fromTrackId !== undefined && fromTrackId === toTrackId) {
    throw new ValidationError('a switch cannot start and end on the same track', { carId: car });
  }
  const record = {
    carId: car,
    kind,
    reason,
    at: moment,
    offsetMinutes,
    fromTrackId: optional(fromTrackId, (value) => requireString(value, 'fromTrackId')),
    toTrackId: optional(toTrackId, (value) => requireString(value, 'toTrackId')),
    consigneeId: optional(consigneeId, (value) =>
      requireString(value, 'consigneeId').toUpperCase()
    ),
    orderedBy: optional(orderedBy, (value) => requireString(value, 'orderedBy')),
    completed: completed === true,
  };
  record.id = fingerprint([
    record.carId,
    record.kind,
    record.at,
    record.fromTrackId,
    record.toTrackId,
  ]);
  return Object.freeze(record);
}

export function isBillable(order) {
  if (!order.completed) {
    return false;
  }
  if (order.kind === SWITCH_KIND.PLACEMENT || order.kind === SWITCH_KIND.PULL) {
    return false;
  }
  return BILLABLE_REASONS.has(order.reason);
}

export function billableOrders(orders) {
  return orders.filter(isBillable);
}

export function ordersForCar(orders, carId) {
  const wanted = normalizeCarId(carId);
  return orders.filter((order) => order.carId === wanted);
}

export function countByKind(orders) {
  const counts = new Map();
  for (const order of orders) {
    counts.set(order.kind, (counts.get(order.kind) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function describeSwitch(order) {
  const legs =
    order.fromTrackId === undefined ? '' : ` ${order.fromTrackId} to ${order.toTrackId ?? 'yard'}`;
  return `${order.carId} ${order.kind}${legs}`;
}
