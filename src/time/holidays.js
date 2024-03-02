import { ValidationError } from '../core/errors.js';
import { requireInteger, requireOneOf, requireString } from '../core/guards.js';
import { addDays, civilDate, dayOfWeek, daysInMonth, formatCivilDate } from './civil.js';

/**
 * Holiday rules. A tariff that excludes holidays from free time has to agree
 * with the carrier on which day the holiday fell, and the disagreements are
 * always about observance: a holiday on a Saturday is kept on the Friday by
 * some books and not at all by others.
 */

export const OBSERVANCE = Object.freeze({
  ACTUAL: 'actual',
  NEAREST_WEEKDAY: 'nearest-weekday',
  FOLLOWING_MONDAY: 'following-monday',
});

const OBSERVANCES = Object.values(OBSERVANCE);

export function fixedHoliday(name, month, day, observance = OBSERVANCE.NEAREST_WEEKDAY) {
  requireString(name, 'name');
  requireInteger(month, 'month', { min: 1, max: 12 });
  requireInteger(day, 'day', { min: 1, max: 31 });
  requireOneOf(observance, OBSERVANCES, 'observance');
  return { kind: 'fixed', name, month, day, observance };
}

export function floatingHoliday(name, month, weekday, ordinal) {
  requireString(name, 'name');
  requireInteger(month, 'month', { min: 1, max: 12 });
  requireInteger(weekday, 'weekday', { min: 0, max: 6 });
  requireInteger(ordinal, 'ordinal', { min: -1, max: 5 });
  if (ordinal === 0) {
    throw new ValidationError('a floating holiday ordinal cannot be zero', { name });
  }
  return { kind: 'floating', name, month, weekday, ordinal, observance: OBSERVANCE.ACTUAL };
}

function observed(date, observance) {
  const weekday = dayOfWeek(date);
  if (observance === OBSERVANCE.ACTUAL) {
    return date;
  }
  if (observance === OBSERVANCE.FOLLOWING_MONDAY) {
    if (weekday === 6) {
      return addDays(date, 2);
    }
    if (weekday === 0) {
      return addDays(date, 1);
    }
    return date;
  }
  if (weekday === 6) {
    return addDays(date, -1);
  }
  if (weekday === 0) {
    return addDays(date, 1);
  }
  return date;
}

export function resolveHoliday(rule, year) {
  requireInteger(year, 'year', { min: 1900, max: 2200 });
  if (rule.kind === 'fixed') {
    const day = Math.min(rule.day, daysInMonth(year, rule.month));
    return observed(civilDate(year, rule.month, day), rule.observance);
  }
  const length = daysInMonth(year, rule.month);
  const matches = [];
  for (let day = 1; day <= length; day += 1) {
    const candidate = civilDate(year, rule.month, day);
    if (dayOfWeek(candidate) === rule.weekday) {
      matches.push(candidate);
    }
  }
  const index = rule.ordinal === -1 ? matches.length - 1 : rule.ordinal - 1;
  if (index < 0 || index >= matches.length) {
    throw new ValidationError('the month does not contain that many of that weekday', {
      name: rule.name,
      year,
    });
  }
  return matches[index];
}

/** The six days the demurrage tariffs in this book treat as holidays. */
export const STANDARD_HOLIDAYS = Object.freeze([
  fixedHoliday('New Year', 1, 1),
  floatingHoliday('Memorial Day', 5, 1, -1),
  fixedHoliday('Independence Day', 7, 4),
  floatingHoliday('Labor Day', 9, 1, 1),
  floatingHoliday('Thanksgiving', 11, 4, 4),
  fixedHoliday('Christmas', 12, 25),
]);

export function holidaySet(rules, years) {
  const set = new Map();
  for (const year of years) {
    for (const rule of rules) {
      const date = resolveHoliday(rule, year);
      set.set(formatCivilDate(date), rule.name);
    }
  }
  return set;
}

export function isHoliday(set, date) {
  return set.has(formatCivilDate(date));
}

export function holidayName(set, date) {
  return set.get(formatCivilDate(date));
}
