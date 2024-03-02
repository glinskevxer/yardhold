import { describe, expect, it } from 'vitest';
import {
  addDays,
  civilDate,
  compareDates,
  dayOfWeek,
  daysBetween,
  dateRange,
  daysInMonth,
  eachDay,
  endOfMonth,
  formatCivilDate,
  fromEpochDay,
  isLeapYear,
  isSameDate,
  isWeekend,
  maxDate,
  minDate,
  parseCivilDate,
  periodKey,
  rangeContains,
  rangeLengthDays,
  startOfMonth,
  toEpochDay,
} from '../../src/time/civil.js';
import { ValidationError } from '../../src/core/errors.js';

describe('calendar facts', () => {
  it('knows the leap years', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('sizes the months', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2025, 4)).toBe(30);
    expect(daysInMonth(2025, 12)).toBe(31);
  });
});

describe('civilDate', () => {
  it('refuses a day the month does not have', () => {
    expect(() => civilDate(2025, 2, 29)).toThrow(ValidationError);
    expect(civilDate(2024, 2, 29)).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('refuses a month outside the year', () => {
    expect(() => civilDate(2025, 13, 1)).toThrow(ValidationError);
  });
});

describe('parsing and formatting', () => {
  it('round trips', () => {
    expect(formatCivilDate(parseCivilDate('2024-03-07'))).toBe('2024-03-07');
  });

  it('pads single digits', () => {
    expect(formatCivilDate(civilDate(2024, 3, 7))).toBe('2024-03-07');
  });

  it('refuses a loose format', () => {
    expect(() => parseCivilDate('3/7/2024')).toThrow(/YYYY-MM-DD/);
    expect(() => parseCivilDate('2024-3-7')).toThrow(/YYYY-MM-DD/);
  });
});

describe('epoch day', () => {
  it('anchors on the epoch', () => {
    expect(toEpochDay(civilDate(1970, 1, 1))).toBe(0);
    expect(toEpochDay(civilDate(1969, 12, 31))).toBe(-1);
  });

  it('round trips across a leap day', () => {
    for (const text of ['2024-02-28', '2024-02-29', '2024-03-01', '2100-03-01']) {
      expect(formatCivilDate(fromEpochDay(toEpochDay(parseCivilDate(text))))).toBe(text);
    }
  });
});

describe('arithmetic', () => {
  it('steps over a month end', () => {
    expect(formatCivilDate(addDays(civilDate(2024, 1, 31), 1))).toBe('2024-02-01');
  });

  it('steps backwards', () => {
    expect(formatCivilDate(addDays(civilDate(2024, 3, 1), -1))).toBe('2024-02-29');
  });

  it('counts the gap', () => {
    expect(daysBetween(civilDate(2024, 2, 27), civilDate(2024, 3, 1))).toBe(3);
    expect(daysBetween(civilDate(2024, 3, 1), civilDate(2024, 2, 27))).toBe(-3);
  });
});

describe('ordering', () => {
  it('compares', () => {
    expect(compareDates(civilDate(2024, 1, 1), civilDate(2024, 1, 2))).toBe(-1);
    expect(compareDates(civilDate(2024, 1, 2), civilDate(2024, 1, 1))).toBe(1);
    expect(isSameDate(civilDate(2024, 1, 1), civilDate(2024, 1, 1))).toBe(true);
  });

  it('picks extremes', () => {
    const early = civilDate(2024, 1, 1);
    const late = civilDate(2024, 6, 1);
    expect(minDate(early, late)).toBe(early);
    expect(maxDate(early, late)).toBe(late);
  });
});

describe('week and month', () => {
  it('numbers the week from Sunday', () => {
    expect(dayOfWeek(civilDate(2024, 3, 3))).toBe(0);
    expect(dayOfWeek(civilDate(2024, 3, 4))).toBe(1);
    expect(dayOfWeek(civilDate(2024, 3, 9))).toBe(6);
  });

  it('spots the weekend', () => {
    expect(isWeekend(civilDate(2024, 3, 9))).toBe(true);
    expect(isWeekend(civilDate(2024, 3, 10))).toBe(true);
    expect(isWeekend(civilDate(2024, 3, 11))).toBe(false);
  });

  it('finds the month ends', () => {
    expect(formatCivilDate(startOfMonth(civilDate(2024, 2, 17)))).toBe('2024-02-01');
    expect(formatCivilDate(endOfMonth(civilDate(2024, 2, 17)))).toBe('2024-02-29');
  });

  it('keys the period', () => {
    expect(periodKey(civilDate(2024, 3, 17))).toBe('202403');
  });
});

describe('eachDay', () => {
  it('is inclusive on both ends', () => {
    const days = eachDay(civilDate(2024, 3, 1), civilDate(2024, 3, 4));
    expect(days.map(formatCivilDate)).toEqual([
      '2024-03-01',
      '2024-03-02',
      '2024-03-03',
      '2024-03-04',
    ]);
  });

  it('is empty when the range runs backwards', () => {
    expect(eachDay(civilDate(2024, 3, 4), civilDate(2024, 3, 1))).toEqual([]);
  });
});

describe('dateRange', () => {
  it('reads both ends off text', () => {
    const range = dateRange('2024-03-01', '2024-03-04');
    expect(formatCivilDate(range.from)).toBe('2024-03-01');
    expect(formatCivilDate(range.to)).toBe('2024-03-04');
  });

  it('treats a single day as a range of one', () => {
    const range = dateRange('2024-03-01');
    expect(rangeLengthDays(range)).toBe(1);
  });

  it('measures the length inclusively', () => {
    expect(rangeLengthDays(dateRange('2024-03-01', '2024-03-04'))).toBe(4);
  });

  it('refuses a backwards range', () => {
    expect(() => dateRange('2024-03-04', '2024-03-01')).toThrow(ValidationError);
  });

  it('answers containment on both ends', () => {
    const range = dateRange('2024-03-01', '2024-03-04');
    expect(rangeContains(range, civilDate(2024, 3, 1))).toBe(true);
    expect(rangeContains(range, civilDate(2024, 3, 4))).toBe(true);
    expect(rangeContains(range, civilDate(2024, 2, 29))).toBe(false);
    expect(rangeContains(range, civilDate(2024, 3, 5))).toBe(false);
  });
});
