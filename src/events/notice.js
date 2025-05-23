import { ValidationError } from '../core/errors.js';
import { optional, requireInteger, requireOneOf, requireString } from '../core/guards.js';
import { MINUTES_PER_DAY, parseInstant } from '../time/instant.js';
import { businessHours, nextOpening, receivedAt } from '../time/businessHours.js';
import { NOTICE_METHOD } from '../site/party.js';
import { normalizeCarId } from '../equipment/reportingMarks.js';

/**
 * Notice of arrival.
 *
 * Sending a notice and giving notice are not the same event. An EDI message is
 * given the moment it is sent because the consignee's system is awake at three
 * in the morning; a phone call at three in the morning is not notice at all and
 * takes effect when the office opens.
 *
 * So the method decides when the clock is allowed to start, and two consignees
 * told at the same minute can start on different days.
 */

export const OFFICE_OPENS_MINUTE = 8 * 60;
export const OFFICE_CLOSES_MINUTE = 17 * 60;

const IMMEDIATE = new Set([NOTICE_METHOD.EDI, NOTICE_METHOD.EMAIL]);

export function notice({
  carId,
  method,
  sentAt,
  offsetMinutes = -360,
  consigneeId,
  address,
  acknowledgedAt,
  officeOpensMinute = OFFICE_OPENS_MINUTE,
  officeClosesMinute = OFFICE_CLOSES_MINUTE,
  calendar,
} = {}) {
  const car = normalizeCarId(requireString(carId, 'carId'));
  requireOneOf(method, Object.values(NOTICE_METHOD), 'method');
  const sent =
    typeof sentAt === 'number'
      ? sentAt
      : parseInstant(requireString(sentAt, 'sentAt'), offsetMinutes);
  requireInteger(officeOpensMinute, 'officeOpensMinute', { min: 0, max: MINUTES_PER_DAY });
  requireInteger(officeClosesMinute, 'officeClosesMinute', { min: 0, max: MINUTES_PER_DAY });
  if (officeClosesMinute <= officeOpensMinute) {
    throw new ValidationError('an office cannot close before it opens', { carId: car });
  }
  const acknowledged =
    acknowledgedAt === undefined
      ? undefined
      : typeof acknowledgedAt === 'number'
        ? acknowledgedAt
        : parseInstant(acknowledgedAt, offsetMinutes);
  if (acknowledged !== undefined && acknowledged < sent) {
    throw new ValidationError('a notice cannot be acknowledged before it was sent', { carId: car });
  }
  return Object.freeze({
    carId: car,
    method,
    sentAt: sent,
    offsetMinutes,
    consigneeId: optional(consigneeId, (value) =>
      requireString(value, 'consigneeId').toUpperCase()
    ),
    address: optional(address, (value) => requireString(value, 'address')),
    acknowledgedAt: acknowledged,
    officeOpensMinute,
    officeClosesMinute,
    effectiveAt: effectiveMoment({
      method,
      sent,
      acknowledged,
      offsetMinutes,
      officeOpensMinute,
      officeClosesMinute,
      calendar,
    }),
  });
}

function effectiveMoment({
  method,
  sent,
  acknowledged,
  offsetMinutes,
  officeOpensMinute,
  officeClosesMinute,
  calendar,
}) {
  if (IMMEDIATE.has(method)) {
    return sent;
  }
  const hours = businessHours({
    opensMinute: officeOpensMinute,
    closesMinute: officeClosesMinute,
    calendar,
  });
  /**
   * A portal posting is not notice until somebody opens it. With no
   * acknowledgement the earliest the office will presume it was read is the
   * next opening, which is the following morning for anything posted after the
   * office was already open.
   */
  if (method === NOTICE_METHOD.PORTAL) {
    return acknowledged ?? nextOpening(hours, sent, offsetMinutes);
  }
  return receivedAt(hours, sent, offsetMinutes);
}

export function isImmediate(record) {
  return record.effectiveAt === record.sentAt;
}

export function delayMinutes(record) {
  return record.effectiveAt - record.sentAt;
}

export function isAcknowledged(record) {
  return record.acknowledgedAt !== undefined;
}

export function noticesForCar(records, carId) {
  const wanted = normalizeCarId(carId);
  return records.filter((record) => record.carId === wanted).sort((a, b) => a.sentAt - b.sentAt);
}

export function firstEffective(records, carId) {
  const found = noticesForCar(records, carId);
  if (found.length === 0) {
    return undefined;
  }
  return found.reduce((best, record) => (record.effectiveAt < best.effectiveAt ? record : best));
}
