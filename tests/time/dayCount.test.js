import { describe, expect, it } from 'vitest';
import { COUNT_BASIS, countUnits, dayUnits, unitLabels } from '../../src/time/dayCount.js';
import { parseInstant } from '../../src/time/instant.js';
import { period } from '../../src/time/period.js';
import { ValidationError } from '../../src/core/errors.js';

const CENTRAL = -360;
const at = (text) => parseInstant(text, CENTRAL);
const span = (from, to) => period(at(from), at(to));

describe('the calendar day basis', () => {
  const options = { basis: COUNT_BASIS.CALENDAR_DAY, offsetMinutes: CENTRAL };

  it('cuts every unit at local midnight', () => {
    const units = dayUnits(span('2024-03-07T08:00', '2024-03-09T08:00'), options);
    expect(units.map((unit) => unit.label)).toEqual(['2024-03-08', '2024-03-09']);
  });

  it('drops the partial first day by default', () => {
    expect(unitLabels(span('2024-03-07T23:50', '2024-03-08T02:00'), options)).toEqual([
      '2024-03-08',
    ]);
  });

  it('counts the partial first day when the tariff says to', () => {
    const labels = unitLabels(span('2024-03-07T23:50', '2024-03-08T02:00'), {
      ...options,
      countPartialFirst: true,
    });
    expect(labels).toEqual(['2024-03-07', '2024-03-08']);
  });

  it('marks a full local day whole', () => {
    const units = dayUnits(span('2024-03-07T00:00', '2024-03-08T00:00'), options);
    expect(units).toHaveLength(1);
    expect(units[0].whole).toBe(true);
    expect(units[0].minutes).toBe(1440);
  });

  it('follows the station offset rather than UTC', () => {
    const target = span('2024-03-07T16:00', '2024-03-07T20:00');
    expect(unitLabels(target, options)).toEqual(['2024-03-07']);
    expect(unitLabels(target, { ...options, offsetMinutes: 0 })).toEqual(['2024-03-08']);
  });
});

describe('the twenty four hour basis', () => {
  const options = { basis: COUNT_BASIS.TWENTY_FOUR_HOUR, offsetMinutes: CENTRAL };

  it('measures from the placement rather than from midnight', () => {
    const units = dayUnits(span('2024-03-07T23:50', '2024-03-08T23:50'), options);
    expect(units).toHaveLength(1);
    expect(units[0].whole).toBe(true);
  });

  it('leaves a short tail as a partial', () => {
    const units = dayUnits(span('2024-03-07T08:00', '2024-03-08T20:00'), options);
    expect(units).toHaveLength(2);
    expect(units[1].whole).toBe(false);
    expect(units[1].minutes).toBe(720);
  });

  it('can be told not to charge the tail', () => {
    const count = countUnits(span('2024-03-07T08:00', '2024-03-08T20:00'), {
      ...options,
      countPartialLast: false,
    });
    expect(count).toBe(1);
  });

  it('disagrees with the calendar basis on the same span', () => {
    const target = span('2024-03-07T23:50', '2024-03-09T01:00');
    const rolling = countUnits(target, options);
    const calendar = countUnits(target, { ...options, basis: COUNT_BASIS.CALENDAR_DAY });
    expect(rolling).toBe(2);
    expect(calendar).toBe(2);
    expect(unitLabels(target, options)).not.toEqual(
      unitLabels(target, { ...options, basis: COUNT_BASIS.CALENDAR_DAY })
    );
  });
});

describe('edges', () => {
  it('has no units for an empty span', () => {
    expect(dayUnits(span('2024-03-07T08:00', '2024-03-07T08:00'))).toEqual([]);
  });

  it('counts a lone partial when either end rule allows it', () => {
    const target = span('2024-03-07T08:00', '2024-03-07T09:00');
    expect(countUnits(target, { countPartialFirst: false, countPartialLast: true })).toBe(1);
    expect(countUnits(target, { countPartialFirst: false, countPartialLast: false })).toBe(0);
  });

  it('honours a minimum before a partial becomes a unit', () => {
    const target = span('2024-03-07T08:00', '2024-03-07T08:30');
    expect(countUnits(target, { minimumPartialMinutes: 60 })).toBe(0);
    expect(countUnits(target, { minimumPartialMinutes: 30 })).toBe(1);
  });

  it('refuses a basis it does not know', () => {
    expect(() =>
      dayUnits(span('2024-03-07T08:00', '2024-03-08T08:00'), { basis: 'weekly' })
    ).toThrow(ValidationError);
  });
});
