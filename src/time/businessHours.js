import { ValidationError } from '../core/errors.js';
import { requireInteger } from '../core/guards.js';
import { addDays } from './civil.js';
import { MINUTES_PER_DAY, dateAt, instantFrom, minuteOfDayAt } from './instant.js';
import { isServiceDay } from './serviceCalendar.js';

/**
 * When an office is open.
 *
 * Pulled out of the notice rules because the same question comes up for a
 * switch order phoned in overnight and for a claim faxed on a Sunday. Given a
 * calendar it will also step over the days the plant does not work, which the
 * notice rules never did and quietly gave the consignee a Saturday morning
 * start.
 */

export function businessHours({ opensMinute = 8 * 60, closesMinute = 17 * 60, calendar } = {}) {
  requireInteger(opensMinute, 'opensMinute', { min: 0, max: MINUTES_PER_DAY });
  requireInteger(closesMinute, 'closesMinute', { min: 0, max: MINUTES_PER_DAY });
  if (closesMinute <= opensMinute) {
    throw new ValidationError('an office cannot close before it opens', {
      opensMinute,
      closesMinute,
    });
  }
  return Object.freeze({ opensMinute, closesMinute, calendar });
}

function isWorkingDay(hours, date) {
  return hours.calendar === undefined || isServiceDay(hours.calendar, date);
}

export function isOpenAt(hours, moment, offsetMinutes = 0) {
  const minute = minuteOfDayAt(moment, offsetMinutes);
  if (!isWorkingDay(hours, dateAt(moment, offsetMinutes))) {
    return false;
  }
  return minute >= hours.opensMinute && minute < hours.closesMinute;
}

export function nextOpening(hours, moment, offsetMinutes = 0) {
  const day = dateAt(moment, offsetMinutes);
  const minute = minuteOfDayAt(moment, offsetMinutes);
  let cursor = minute < hours.opensMinute ? day : addDays(day, 1);
  for (let guard = 0; guard < 400; guard += 1) {
    if (isWorkingDay(hours, cursor)) {
      return instantFrom(cursor, hours.opensMinute, offsetMinutes);
    }
    cursor = addDays(cursor, 1);
  }
  throw new ValidationError('no working day found within a year', {});
}

/** The moment something handed in at `moment` is treated as received. */
export function receivedAt(hours, moment, offsetMinutes = 0) {
  return isOpenAt(hours, moment, offsetMinutes)
    ? moment
    : nextOpening(hours, moment, offsetMinutes);
}

export function waitMinutes(hours, moment, offsetMinutes = 0) {
  return receivedAt(hours, moment, offsetMinutes) - moment;
}

export function openMinutesPerDay(hours) {
  return hours.closesMinute - hours.opensMinute;
}

export const STANDARD_HOURS = businessHours();
