import { ValidationError } from '../core/errors.js';
import { optional, requireInteger, requireOneOf, requireString } from '../core/guards.js';
import { fingerprint } from '../core/ids.js';
import { formatInstant, parseInstant } from '../time/instant.js';
import { normalizeCarId } from '../equipment/reportingMarks.js';
import { eventKind } from './eventTypes.js';
import { DEFAULT_OFFSET_MINUTES } from '../time/instant.js';

/**
 * One reported event. The source matters as much as the code: a stamp the
 * carrier sent is evidence, a stamp the office typed in is an assertion, and a
 * dispute over the free time count usually turns on which one it was.
 */

export const EVENT_SOURCE = Object.freeze({
  CARRIER: 'carrier',
  OFFICE: 'office',
  DERIVED: 'derived',
});

const SOURCES = Object.values(EVENT_SOURCE);

export function trackEvent({
  carId,
  code,
  at,
  offsetMinutes = DEFAULT_OFFSET_MINUTES,
  trackId,
  spot,
  source = EVENT_SOURCE.CARRIER,
  reason,
  reportedAt,
  supersedes,
  cancelled = false,
} = {}) {
  const car = normalizeCarId(requireString(carId, 'carId'));
  const kind = eventKind(requireString(code, 'code'));
  requireInteger(offsetMinutes, 'offsetMinutes', { min: -840, max: 840 });
  const moment = typeof at === 'number' ? at : parseInstant(requireString(at, 'at'), offsetMinutes);
  const reported =
    reportedAt === undefined
      ? moment
      : typeof reportedAt === 'number'
        ? reportedAt
        : parseInstant(reportedAt, offsetMinutes);
  if (reported < moment) {
    throw new ValidationError('an event cannot be reported before it happened', {
      carId: car,
      code: kind.code,
    });
  }
  requireOneOf(source, SOURCES, 'source');
  if (source === EVENT_SOURCE.OFFICE && reason === undefined) {
    throw new ValidationError('an event the office entered needs a reason', {
      carId: car,
      code: kind.code,
    });
  }
  const record = {
    carId: car,
    code: kind.code,
    at: moment,
    offsetMinutes,
    trackId: optional(trackId, (value) => requireString(value, 'trackId')),
    spot: optional(spot, (value) => requireString(value, 'spot').trim().toUpperCase()),
    source,
    reason: optional(reason, (value) => requireString(value, 'reason')),
    reportedAt: reported,
    supersedes: optional(supersedes, (value) => requireString(value, 'supersedes')),
    cancelled: cancelled === true,
  };
  record.id = eventId(record);
  return Object.freeze(record);
}

export function eventId(record) {
  return fingerprint([record.carId, record.code, record.at, record.trackId, record.spot]);
}

export function isCancelled(record) {
  return record.cancelled === true;
}

export function isCarrierReported(record) {
  return record.source === EVENT_SOURCE.CARRIER;
}

export function cancel(record, reason) {
  return Object.freeze({
    ...record,
    cancelled: true,
    reason: requireString(reason, 'reason'),
  });
}

export function reportingLagMinutes(record) {
  return record.reportedAt - record.at;
}

export function formatEvent(record) {
  const where = record.trackId ? ` ${record.trackId}` : '';
  return `${record.carId} ${record.code} ${formatInstant(record.at, record.offsetMinutes)}${where}`;
}

export function compareEvents(left, right) {
  if (left.at !== right.at) {
    return left.at - right.at;
  }
  const positions = eventKind(left.code).position - eventKind(right.code).position;
  if (positions !== 0) {
    return positions;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
