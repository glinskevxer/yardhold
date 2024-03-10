import { requireInteger, requireOneOf } from '../core/guards.js';
import { addDays, formatCivilDate } from './civil.js';
import { MINUTES_PER_DAY, dateAt, instantFrom, minutesBetween } from './instant.js';
import { durationMinutes, period } from './period.js';

/**
 * Turning a span of time on the track into a list of days is the whole
 * argument. Two conventions are in use and they do not agree:
 *
 *   calendar-day       every unit ends at local midnight, so a car placed at
 *                      23:50 has burned a day by ten to midnight
 *   twenty-four-hour   every unit is 1440 minutes measured from the placement,
 *                      so the same car keeps its day until 23:50 tomorrow
 *
 * The basis is a property of the tariff, not of the car, and it decides what
 * every later rule is counting. A partial unit at either end is only a unit if
 * the tariff says so, which is the second half of the same decision.
 */

export const COUNT_BASIS = Object.freeze({
  CALENDAR_DAY: 'calendar-day',
  TWENTY_FOUR_HOUR: 'twenty-four-hour',
});

const BASES = Object.values(COUNT_BASIS);

export function dayUnits(
  span,
  {
    basis = COUNT_BASIS.CALENDAR_DAY,
    offsetMinutes = 0,
    countPartialFirst = false,
    countPartialLast = true,
    minimumPartialMinutes = 1,
  } = {}
) {
  requireOneOf(basis, BASES, 'basis');
  requireInteger(offsetMinutes, 'offsetMinutes', { min: -840, max: 840 });
  requireInteger(minimumPartialMinutes, 'minimumPartialMinutes', { min: 0 });
  if (durationMinutes(span) === 0) {
    return [];
  }
  const raw =
    basis === COUNT_BASIS.CALENDAR_DAY
      ? calendarUnits(span, offsetMinutes)
      : rollingUnits(span, offsetMinutes);
  return raw
    .map((unit, index) => ({ ...unit, index }))
    .filter((unit) =>
      keepUnit(unit, raw.length, { countPartialFirst, countPartialLast, minimumPartialMinutes })
    );
}

function keepUnit(unit, total, options) {
  if (unit.whole) {
    return true;
  }
  if (unit.index === 0 && total > 1) {
    return options.countPartialFirst && unit.minutes >= options.minimumPartialMinutes;
  }
  if (unit.index === 0 && total === 1) {
    return (
      (options.countPartialFirst || options.countPartialLast) &&
      unit.minutes >= options.minimumPartialMinutes
    );
  }
  return options.countPartialLast && unit.minutes >= options.minimumPartialMinutes;
}

function calendarUnits(span, offsetMinutes) {
  const units = [];
  let cursor = span.start;
  let day = dateAt(cursor, offsetMinutes);
  while (cursor < span.end) {
    const nextMidnight = instantFrom(addDays(day, 1), 0, offsetMinutes);
    const end = Math.min(nextMidnight, span.end);
    const minutes = minutesBetween(cursor, end);
    units.push({
      date: day,
      label: formatCivilDate(day),
      span: period(cursor, end),
      minutes,
      whole: minutes === MINUTES_PER_DAY,
    });
    cursor = end;
    day = addDays(day, 1);
  }
  return units;
}

function rollingUnits(span, offsetMinutes) {
  const units = [];
  let cursor = span.start;
  while (cursor < span.end) {
    const end = Math.min(cursor + MINUTES_PER_DAY, span.end);
    const minutes = minutesBetween(cursor, end);
    const day = dateAt(cursor, offsetMinutes);
    units.push({
      date: day,
      label: formatCivilDate(day),
      span: period(cursor, end),
      minutes,
      whole: minutes === MINUTES_PER_DAY,
    });
    cursor = end;
  }
  return units;
}

export function countUnits(span, options) {
  return dayUnits(span, options).length;
}

export function unitLabels(span, options) {
  return dayUnits(span, options).map((unit) => unit.label);
}
