import { ValidationError } from '../core/errors.js';
import { requireArray, requireInteger, requireString } from '../core/guards.js';
import {
  addDays,
  compareDates,
  dayOfWeek,
  formatCivilDate,
  parseCivilDate,
  toEpochDay,
} from './civil.js';
import { STANDARD_HOLIDAYS, holidaySet, isHoliday } from './holidays.js';

/**
 * A service calendar answers one question: did the carrier work this track on
 * this day. Free time is counted against it, the pull is scheduled against it,
 * and a plant that shuts for its own reasons is a different matter entirely
 * because the carrier still came.
 */

export function serviceCalendar({
  id,
  offsetMinutes = -360,
  serviceDays = [1, 2, 3, 4, 5],
  holidayRules = STANDARD_HOLIDAYS,
  years = [],
  closures = [],
} = {}) {
  requireString(id, 'id');
  requireInteger(offsetMinutes, 'offsetMinutes', { min: -840, max: 840 });
  requireArray(serviceDays, 'serviceDays', { minLength: 1 });
  for (const day of serviceDays) {
    requireInteger(day, 'serviceDay', { min: 0, max: 6 });
  }
  const holidays = holidaySet(holidayRules, years);
  const closureSet = new Set();
  for (const closure of closures) {
    for (const key of expandClosure(closure)) {
      closureSet.add(key);
    }
  }
  return {
    id,
    offsetMinutes,
    serviceDays: [...new Set(serviceDays)].sort((a, b) => a - b),
    holidays,
    closures: closureSet,
  };
}

function expandClosure(closure) {
  const from = typeof closure === 'string' ? parseCivilDate(closure) : parseCivilDate(closure.from);
  const to = typeof closure === 'string' ? from : parseCivilDate(closure.to ?? closure.from);
  if (compareDates(from, to) > 0) {
    throw new ValidationError('a closure cannot end before it starts', { closure });
  }
  const keys = [];
  const last = toEpochDay(to);
  for (let cursor = toEpochDay(from); cursor <= last; cursor += 1) {
    keys.push(formatCivilDate(addDays(from, cursor - toEpochDay(from))));
  }
  return keys;
}

export function isServiceWeekday(calendar, date) {
  return calendar.serviceDays.includes(dayOfWeek(date));
}

export function isCalendarHoliday(calendar, date) {
  return isHoliday(calendar.holidays, date);
}

export function isPlantClosed(calendar, date) {
  return calendar.closures.has(formatCivilDate(date));
}

/**
 * A service day is one the carrier works. A plant closure does not make it one
 * of the carrier's non service days, which is the whole point of keeping the
 * two sets apart.
 */
export function isServiceDay(calendar, date) {
  return isServiceWeekday(calendar, date) && !isCalendarHoliday(calendar, date);
}

export function nextServiceDay(calendar, date, { inclusive = false } = {}) {
  let cursor = inclusive ? date : addDays(date, 1);
  for (let guard = 0; guard < 400; guard += 1) {
    if (isServiceDay(calendar, cursor)) {
      return cursor;
    }
    cursor = addDays(cursor, 1);
  }
  throw new ValidationError('no service day found within a year', { calendar: calendar.id });
}

export function previousServiceDay(calendar, date, { inclusive = false } = {}) {
  let cursor = inclusive ? date : addDays(date, -1);
  for (let guard = 0; guard < 400; guard += 1) {
    if (isServiceDay(calendar, cursor)) {
      return cursor;
    }
    cursor = addDays(cursor, -1);
  }
  throw new ValidationError('no service day found within a year', { calendar: calendar.id });
}

export function countServiceDays(calendar, from, to) {
  if (compareDates(from, to) > 0) {
    return 0;
  }
  let count = 0;
  const last = toEpochDay(to);
  for (let cursor = toEpochDay(from); cursor <= last; cursor += 1) {
    if (isServiceDay(calendar, addDays(from, cursor - toEpochDay(from)))) {
      count += 1;
    }
  }
  return count;
}

export function addServiceDays(calendar, date, count) {
  requireInteger(count, 'count', { min: 0 });
  let cursor = date;
  let remaining = count;
  while (remaining > 0) {
    cursor = nextServiceDay(calendar, cursor);
    remaining -= 1;
  }
  return cursor;
}

export function describeDay(calendar, date) {
  if (isCalendarHoliday(calendar, date)) {
    return 'holiday';
  }
  if (!isServiceWeekday(calendar, date)) {
    return 'no-service';
  }
  if (isPlantClosed(calendar, date)) {
    return 'plant-closed';
  }
  return 'service';
}
