import { describe, expect, it } from 'vitest';
import {
  addServiceDays,
  countServiceDays,
  describeDay,
  isCalendarHoliday,
  isPlantClosed,
  isServiceDay,
  isServiceWeekday,
  nextServiceDay,
  previousServiceDay,
  serviceCalendar,
} from '../../src/time/serviceCalendar.js';
import { civilDate, formatCivilDate, parseCivilDate } from '../../src/time/civil.js';
import { ValidationError } from '../../src/core/errors.js';

const calendar = serviceCalendar({
  id: 'MEMPHIS-NORTH',
  years: [2024],
  closures: [{ from: '2024-07-01', to: '2024-07-05' }, '2024-03-15'],
});

const sevenDay = serviceCalendar({
  id: 'ROUND',
  serviceDays: [0, 1, 2, 3, 4, 5, 6],
  years: [2024],
});

describe('construction', () => {
  it('needs an id', () => {
    expect(() => serviceCalendar({})).toThrow(ValidationError);
  });

  it('needs at least one service weekday', () => {
    expect(() => serviceCalendar({ id: 'X', serviceDays: [] })).toThrow(ValidationError);
  });

  it('sorts and dedupes the weekdays', () => {
    const cal = serviceCalendar({ id: 'X', serviceDays: [3, 1, 3] });
    expect(cal.serviceDays).toEqual([1, 3]);
  });

  it('refuses a backwards closure', () => {
    expect(() =>
      serviceCalendar({ id: 'X', closures: [{ from: '2024-03-05', to: '2024-03-01' }] })
    ).toThrow(/end before it starts/);
  });

  it('expands a closure range and a bare day', () => {
    expect(calendar.closures.size).toBe(6);
    expect(isPlantClosed(calendar, civilDate(2024, 7, 3))).toBe(true);
    expect(isPlantClosed(calendar, civilDate(2024, 3, 15))).toBe(true);
    expect(isPlantClosed(calendar, civilDate(2024, 7, 6))).toBe(false);
  });
});

describe('service days', () => {
  it('works the weekdays only', () => {
    expect(isServiceWeekday(calendar, civilDate(2024, 3, 11))).toBe(true);
    expect(isServiceWeekday(calendar, civilDate(2024, 3, 9))).toBe(false);
  });

  it('drops the holidays', () => {
    expect(isCalendarHoliday(calendar, civilDate(2024, 9, 2))).toBe(true);
    expect(isServiceDay(calendar, civilDate(2024, 9, 2))).toBe(false);
  });

  it('still counts a day the plant shut but the carrier worked', () => {
    expect(isPlantClosed(calendar, civilDate(2024, 7, 2))).toBe(true);
    expect(isServiceDay(calendar, civilDate(2024, 7, 2))).toBe(true);
  });

  it('runs every day when the calendar says so', () => {
    expect(isServiceDay(sevenDay, civilDate(2024, 3, 9))).toBe(true);
    expect(isServiceDay(sevenDay, civilDate(2024, 9, 2))).toBe(false);
  });
});

describe('walking the calendar', () => {
  it('steps past a weekend', () => {
    const next = nextServiceDay(calendar, civilDate(2024, 3, 8));
    expect(formatCivilDate(next)).toBe('2024-03-11');
  });

  it('can include the day it starts on', () => {
    const same = nextServiceDay(calendar, civilDate(2024, 3, 11), { inclusive: true });
    expect(formatCivilDate(same)).toBe('2024-03-11');
  });

  it('steps backwards past a holiday', () => {
    const previous = previousServiceDay(calendar, civilDate(2024, 9, 3));
    expect(formatCivilDate(previous)).toBe('2024-08-30');
  });

  it('adds a run of service days', () => {
    const landed = addServiceDays(calendar, civilDate(2024, 8, 29), 3);
    expect(formatCivilDate(landed)).toBe('2024-09-04');
  });

  it('returns the same day when asked for zero', () => {
    const start = civilDate(2024, 8, 29);
    expect(addServiceDays(calendar, start, 0)).toBe(start);
  });
});

describe('counting', () => {
  it('counts inclusive of both ends', () => {
    const count = countServiceDays(
      calendar,
      parseCivilDate('2024-03-11'),
      parseCivilDate('2024-03-15')
    );
    expect(count).toBe(5);
  });

  it('skips the weekend and the holiday', () => {
    const count = countServiceDays(
      calendar,
      parseCivilDate('2024-08-30'),
      parseCivilDate('2024-09-03')
    );
    expect(count).toBe(2);
  });

  it('is zero on a backwards range', () => {
    expect(
      countServiceDays(calendar, parseCivilDate('2024-03-15'), parseCivilDate('2024-03-11'))
    ).toBe(0);
  });
});

describe('describeDay', () => {
  it('names each kind of day', () => {
    expect(describeDay(calendar, civilDate(2024, 3, 11))).toBe('service');
    expect(describeDay(calendar, civilDate(2024, 3, 9))).toBe('no-service');
    expect(describeDay(calendar, civilDate(2024, 9, 2))).toBe('holiday');
    expect(describeDay(calendar, civilDate(2024, 7, 2))).toBe('plant-closed');
  });
});
