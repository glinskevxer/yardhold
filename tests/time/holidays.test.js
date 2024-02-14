import { describe, expect, it } from 'vitest';
import {
  OBSERVANCE,
  STANDARD_HOLIDAYS,
  fixedHoliday,
  floatingHoliday,
  holidayName,
  holidaySet,
  isHoliday,
  resolveHoliday,
} from '../../src/time/holidays.js';
import { civilDate, formatCivilDate } from '../../src/time/civil.js';
import { ValidationError } from '../../src/core/errors.js';

const shown = (rule, year) => formatCivilDate(resolveHoliday(rule, year));

describe('fixed holidays', () => {
  it('lands on the day itself midweek', () => {
    expect(shown(fixedHoliday('Independence Day', 7, 4), 2024)).toBe('2024-07-04');
  });

  it('keeps a Saturday holiday on the Friday by default', () => {
    expect(shown(fixedHoliday('Independence Day', 7, 4), 2026)).toBe('2026-07-03');
  });

  it('keeps a Sunday holiday on the Monday by default', () => {
    expect(shown(fixedHoliday('Christmas', 12, 25), 2022)).toBe('2022-12-26');
  });

  it('can be told not to shift at all', () => {
    const rule = fixedHoliday('Independence Day', 7, 4, OBSERVANCE.ACTUAL);
    expect(shown(rule, 2026)).toBe('2026-07-04');
  });

  it('can push a weekend holiday to the following Monday', () => {
    const rule = fixedHoliday('Independence Day', 7, 4, OBSERVANCE.FOLLOWING_MONDAY);
    expect(shown(rule, 2026)).toBe('2026-07-06');
    expect(shown(rule, 2027)).toBe('2027-07-05');
  });

  it('clamps a day the month is too short for', () => {
    expect(shown(fixedHoliday('Odd', 2, 31, OBSERVANCE.ACTUAL), 2025)).toBe('2025-02-28');
    expect(shown(fixedHoliday('Odd', 2, 31, OBSERVANCE.ACTUAL), 2024)).toBe('2024-02-29');
  });

  it('refuses a bad observance', () => {
    expect(() => fixedHoliday('Odd', 1, 1, 'whenever')).toThrow(ValidationError);
  });
});

describe('floating holidays', () => {
  it('finds the first Monday', () => {
    expect(shown(floatingHoliday('Labor Day', 9, 1, 1), 2024)).toBe('2024-09-02');
  });

  it('finds the fourth Thursday', () => {
    expect(shown(floatingHoliday('Thanksgiving', 11, 4, 4), 2024)).toBe('2024-11-28');
    expect(shown(floatingHoliday('Thanksgiving', 11, 4, 4), 2025)).toBe('2025-11-27');
  });

  it('finds the last Monday', () => {
    expect(shown(floatingHoliday('Memorial Day', 5, 1, -1), 2024)).toBe('2024-05-27');
    expect(shown(floatingHoliday('Memorial Day', 5, 1, -1), 2025)).toBe('2025-05-26');
  });

  it('refuses a zero ordinal', () => {
    expect(() => floatingHoliday('Bad', 5, 1, 0)).toThrow(ValidationError);
  });

  it('refuses an ordinal the month cannot supply', () => {
    expect(() => resolveHoliday(floatingHoliday('Bad', 2, 1, 5), 2025)).toThrow(/that many/);
  });
});

describe('the standard set', () => {
  it('carries six rules', () => {
    expect(STANDARD_HOLIDAYS).toHaveLength(6);
  });

  it('resolves a year into observed dates', () => {
    const set = holidaySet(STANDARD_HOLIDAYS, [2024]);
    expect([...set.keys()].sort()).toEqual([
      '2024-01-01',
      '2024-05-27',
      '2024-07-04',
      '2024-09-02',
      '2024-11-28',
      '2024-12-25',
    ]);
  });

  it('answers membership and names', () => {
    const set = holidaySet(STANDARD_HOLIDAYS, [2024, 2025]);
    expect(isHoliday(set, civilDate(2024, 11, 28))).toBe(true);
    expect(isHoliday(set, civilDate(2024, 11, 29))).toBe(false);
    expect(holidayName(set, civilDate(2025, 9, 1))).toBe('Labor Day');
    expect(holidayName(set, civilDate(2025, 9, 2))).toBeUndefined();
  });

  it('spans several years without collision', () => {
    const set = holidaySet(STANDARD_HOLIDAYS, [2024, 2025, 2026]);
    expect(set.size).toBe(18);
  });
});
