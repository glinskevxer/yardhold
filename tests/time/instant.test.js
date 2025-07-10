import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OFFSET_MINUTES,
  MINUTES_PER_DAY,
  addHours,
  addMinutes,
  compareInstants,
  dateAt,
  earliest,
  formatInstant,
  formatOffset,
  instantFrom,
  latest,
  minuteOfDayAt,
  minutesBetween,
  parseInstant,
  parseOffset,
  splitInstant,
} from '../../src/time/instant.js';
import { civilDate, formatCivilDate } from '../../src/time/civil.js';
import { ValidationError } from '../../src/core/errors.js';

const CENTRAL = -360;

describe('offsets', () => {
  it('reads the written forms', () => {
    expect(parseOffset('Z')).toBe(0);
    expect(parseOffset(undefined)).toBe(0);
    expect(parseOffset('-06:00')).toBe(-360);
    expect(parseOffset('+0530')).toBe(330);
  });

  it('refuses junk', () => {
    expect(() => parseOffset('-6')).toThrow(ValidationError);
  });

  it('writes them back', () => {
    expect(formatOffset(0)).toBe('Z');
    expect(formatOffset(-360)).toBe('-06:00');
    expect(formatOffset(330)).toBe('+05:30');
  });
});

describe('parseInstant', () => {
  it('reads an explicit offset', () => {
    const value = parseInstant('2024-03-07T14:30-06:00');
    expect(formatInstant(value, CENTRAL)).toBe('2024-03-07T14:30-06:00');
  });

  it('falls back to the station offset when none is written', () => {
    const local = parseInstant('2024-03-07T14:30', CENTRAL);
    const explicit = parseInstant('2024-03-07T14:30-06:00');
    expect(local).toBe(explicit);
  });

  it('accepts a space separator and a seconds field', () => {
    expect(parseInstant('2024-03-07 14:30:59Z')).toBe(parseInstant('2024-03-07T14:30Z'));
  });

  it('refuses an impossible time of day', () => {
    expect(() => parseInstant('2024-03-07T24:00Z')).toThrow(/impossible/);
    expect(() => parseInstant('2024-03-07T12:60Z')).toThrow(/impossible/);
  });

  it('refuses a non string and a bad shape', () => {
    expect(() => parseInstant(0)).toThrow(ValidationError);
    expect(() => parseInstant('March 7')).toThrow(ValidationError);
  });
});

describe('splitting at an offset', () => {
  it('moves the date backwards across local midnight', () => {
    const value = parseInstant('2024-03-08T04:30Z');
    expect(formatCivilDate(dateAt(value, CENTRAL))).toBe('2024-03-07');
    expect(minuteOfDayAt(value, CENTRAL)).toBe(22 * 60 + 30);
  });

  it('keeps the same date in UTC', () => {
    const value = parseInstant('2024-03-08T04:30Z');
    expect(formatCivilDate(dateAt(value))).toBe('2024-03-08');
  });

  it('reports both halves at once', () => {
    const split = splitInstant(parseInstant('2024-03-07T00:00-06:00'), CENTRAL);
    expect(formatCivilDate(split.date)).toBe('2024-03-07');
    expect(split.minuteOfDay).toBe(0);
  });
});

describe('instantFrom', () => {
  it('builds from a date and a minute of day', () => {
    const value = instantFrom(civilDate(2024, 3, 7), 14 * 60 + 30, CENTRAL);
    expect(formatInstant(value, CENTRAL)).toBe('2024-03-07T14:30-06:00');
  });

  it('accepts the end of day marker', () => {
    const value = instantFrom(civilDate(2024, 3, 7), MINUTES_PER_DAY, CENTRAL);
    expect(formatInstant(value, CENTRAL)).toBe('2024-03-08T00:00-06:00');
  });

  it('refuses a minute past the end of day', () => {
    expect(() => instantFrom(civilDate(2024, 3, 7), 1441)).toThrow(ValidationError);
  });
});

describe('arithmetic and ordering', () => {
  const base = parseInstant('2024-03-07T14:30Z');

  it('adds minutes and hours', () => {
    expect(minutesBetween(base, addMinutes(base, 90))).toBe(90);
    expect(minutesBetween(base, addHours(base, -2))).toBe(-120);
  });

  it('compares', () => {
    expect(compareInstants(base, addMinutes(base, 1))).toBe(-1);
    expect(compareInstants(addMinutes(base, 1), base)).toBe(1);
    expect(compareInstants(base, base)).toBe(0);
  });

  it('picks the ends of a set', () => {
    const values = [base, addHours(base, 5), addHours(base, -3)];
    expect(earliest(values)).toBe(addHours(base, -3));
    expect(latest(values)).toBe(addHours(base, 5));
  });
});

describe('the default station offset', () => {
  it('is central standard time', () => {
    expect(DEFAULT_OFFSET_MINUTES).toBe(-360);
    expect(formatOffset(DEFAULT_OFFSET_MINUTES)).toBe('-06:00');
  });

  it('is what CENTRAL means everywhere in these tests', () => {
    expect(CENTRAL).toBe(DEFAULT_OFFSET_MINUTES);
  });

  it('reads a stamp with no zone at it', () => {
    expect(parseInstant('2024-03-07T14:30', DEFAULT_OFFSET_MINUTES)).toBe(
      parseInstant('2024-03-07T14:30-06:00')
    );
  });
});
