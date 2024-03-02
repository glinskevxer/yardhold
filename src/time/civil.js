import { ValidationError } from '../core/errors.js';
import { requireInteger, requireString } from '../core/guards.js';

/**
 * A civil date is a plain calendar day with no zone and no time of day. Free
 * time, tariff effectivity and the invoice period are all expressed in these,
 * because a demurrage day belongs to a station's local calendar and never to
 * an instant on the clock.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year, month) {
  requireInteger(month, 'month', { min: 1, max: 12 });
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return DAYS_IN_MONTH[month - 1];
}

export function civilDate(year, month, day) {
  requireInteger(year, 'year', { min: 1900, max: 2200 });
  requireInteger(month, 'month', { min: 1, max: 12 });
  requireInteger(day, 'day', { min: 1, max: daysInMonth(year, month) });
  return { year, month, day };
}

export function parseCivilDate(text) {
  requireString(text, 'date');
  const match = DATE_PATTERN.exec(text.trim());
  if (!match) {
    throw new ValidationError('date must be written YYYY-MM-DD', { text });
  }
  return civilDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function formatCivilDate(date) {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}

/** Days since 1970-01-01, so date arithmetic is integer arithmetic. */
export function toEpochDay(date) {
  const year = date.year;
  const month = date.month;
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const monthTerm = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.floor((153 * monthTerm + 2) / 5) + date.day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

export function fromEpochDay(epochDay) {
  requireInteger(epochDay, 'epochDay');
  const shifted = epochDay + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthTerm = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthTerm + 2) / 5) + 1;
  const month = monthTerm < 10 ? monthTerm + 3 : monthTerm - 9;
  return civilDate(month <= 2 ? year + 1 : year, month, day);
}

export function addDays(date, count) {
  requireInteger(count, 'count');
  return fromEpochDay(toEpochDay(date) + count);
}

export function daysBetween(from, to) {
  return toEpochDay(to) - toEpochDay(from);
}

export function compareDates(left, right) {
  const a = toEpochDay(left);
  const b = toEpochDay(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isSameDate(left, right) {
  return compareDates(left, right) === 0;
}

export function minDate(left, right) {
  return compareDates(left, right) <= 0 ? left : right;
}

export function maxDate(left, right) {
  return compareDates(left, right) >= 0 ? left : right;
}

/** 0 is Sunday, matching the way the service calendars are written down. */
export function dayOfWeek(date) {
  const epochDay = toEpochDay(date);
  return (((epochDay + 4) % 7) + 7) % 7;
}

export function isWeekend(date) {
  const day = dayOfWeek(date);
  return day === 0 || day === 6;
}

export function startOfMonth(date) {
  return civilDate(date.year, date.month, 1);
}

export function endOfMonth(date) {
  return civilDate(date.year, date.month, daysInMonth(date.year, date.month));
}

export function periodKey(date) {
  return `${date.year}${String(date.month).padStart(2, '0')}`;
}

export function eachDay(from, to) {
  const days = [];
  const last = toEpochDay(to);
  for (let cursor = toEpochDay(from); cursor <= last; cursor += 1) {
    days.push(fromEpochDay(cursor));
  }
  return days;
}

/**
 * Read a closed date range off a record. The two ends arrive as text on every
 * feed we take, and every caller was writing the same three lines.
 */
export function dateRange(fromText, toText = fromText) {
  const from = parseCivilDate(fromText);
  const to = parseCivilDate(toText);
  if (compareDates(from, to) > 0) {
    throw new ValidationError('a date range cannot end before it starts', { fromText, toText });
  }
  return { from, to };
}

export function rangeLengthDays(range) {
  return daysBetween(range.from, range.to) + 1;
}

export function rangeContains(range, date) {
  return compareDates(range.from, date) <= 0 && compareDates(date, range.to) <= 0;
}
