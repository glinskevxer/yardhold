import { ValidationError } from '../core/errors.js';
import { requireInteger } from '../core/guards.js';
import { civilDate, formatCivilDate, fromEpochDay, toEpochDay } from './civil.js';

/**
 * An instant is a whole number of minutes since the epoch, in UTC. Carrier
 * feeds report placement and release to the minute and never finer, so seconds
 * would only ever be noise that two systems disagree about.
 *
 * Every station carries a fixed offset in minutes. Rail operating calendars in
 * this book are kept on standard time year round, which is why there is no
 * daylight saving rule anywhere in here.
 */

const STAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?(Z|[+-]\d{2}:?\d{2})?$/;

export const MINUTES_PER_DAY = 1440;

export function instant(epochMinute) {
  requireInteger(epochMinute, 'epochMinute');
  return epochMinute;
}

export function instantFrom(date, minuteOfDay, offsetMinutes = 0) {
  requireInteger(minuteOfDay, 'minuteOfDay', { min: 0, max: MINUTES_PER_DAY });
  requireInteger(offsetMinutes, 'offsetMinutes', { min: -840, max: 840 });
  return instant(toEpochDay(date) * MINUTES_PER_DAY + minuteOfDay - offsetMinutes);
}

export function parseOffset(text) {
  if (text === undefined || text === 'Z') {
    return 0;
  }
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(text);
  if (!match) {
    throw new ValidationError('offset must be written +HH:MM or Z', { text });
  }
  const magnitude = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -magnitude : magnitude;
}

export function formatOffset(offsetMinutes) {
  if (offsetMinutes === 0) {
    return 'Z';
  }
  const sign = offsetMinutes < 0 ? '-' : '+';
  const magnitude = Math.abs(offsetMinutes);
  const hours = String(Math.floor(magnitude / 60)).padStart(2, '0');
  const minutes = String(magnitude % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

/**
 * Parse a stamp. A stamp with no offset is read at `defaultOffset`, which is
 * how the carrier feeds arrive: local station time with the zone left implied.
 */
export function parseInstant(text, defaultOffset = 0) {
  if (typeof text !== 'string') {
    throw new ValidationError('timestamp must be a string', { text });
  }
  const match = STAMP_PATTERN.exec(text.trim());
  if (!match) {
    throw new ValidationError('timestamp must be written YYYY-MM-DDTHH:MM', { text });
  }
  const date = civilDate(Number(match[1]), Number(match[2]), Number(match[3]));
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour > 23 || minute > 59) {
    throw new ValidationError('timestamp carries an impossible time of day', { text });
  }
  const offset = match[6] === undefined ? defaultOffset : parseOffset(match[6]);
  return instantFrom(date, hour * 60 + minute, offset);
}

export function splitInstant(value, offsetMinutes = 0) {
  const local = instant(value) + offsetMinutes;
  const epochDay = Math.floor(local / MINUTES_PER_DAY);
  const minuteOfDay = local - epochDay * MINUTES_PER_DAY;
  return { date: fromEpochDay(epochDay), minuteOfDay };
}

export function dateAt(value, offsetMinutes = 0) {
  return splitInstant(value, offsetMinutes).date;
}

export function minuteOfDayAt(value, offsetMinutes = 0) {
  return splitInstant(value, offsetMinutes).minuteOfDay;
}

export function formatInstant(value, offsetMinutes = 0) {
  const { date, minuteOfDay } = splitInstant(value, offsetMinutes);
  const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const minutes = String(minuteOfDay % 60).padStart(2, '0');
  return `${formatCivilDate(date)}T${hours}:${minutes}${formatOffset(offsetMinutes)}`;
}

export function addMinutes(value, minutes) {
  return instant(value + requireInteger(minutes, 'minutes'));
}

export function addHours(value, hours) {
  return addMinutes(value, requireInteger(hours, 'hours') * 60);
}

export function minutesBetween(from, to) {
  return instant(to) - instant(from);
}

export function compareInstants(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function earliest(values) {
  return values.reduce((best, value) => (value < best ? value : best));
}

export function latest(values) {
  return values.reduce((best, value) => (value > best ? value : best));
}
