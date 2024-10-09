import { describe, expect, it } from 'vitest';
import {
  dwellForCar,
  dwellSummary,
  fromDetentions,
  meanMinutes,
  medianMinutes,
  percentileMinutes,
  toDays,
  worstDwell,
} from '../../src/reporting/dwell.js';
import { parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const at = (text) => parseInstant(text, -360);

describe('dwellForCar', () => {
  const row = dwellForCar({
    carId: 'BNSF 400123',
    arrivedAt: at('2024-03-06T22:00'),
    placedAt: at('2024-03-07T08:00'),
    releasedAt: at('2024-03-09T08:00'),
    pulledAt: at('2024-03-10T08:00'),
  });

  it('splits the three stretches', () => {
    expect(row.yardMinutes).toBe(600);
    expect(row.plantMinutes).toBe(2880);
    expect(row.idleMinutes).toBe(1440);
  });

  it('measures the whole visit', () => {
    expect(row.totalMinutes).toBe(600 + 2880 + 1440);
  });

  it('leaves out what it was not told', () => {
    const partial = dwellForCar({ carId: 'A', placedAt: at('2024-03-07T08:00') });
    expect(partial.yardMinutes).toBeUndefined();
    expect(partial.plantMinutes).toBeUndefined();
    expect(partial.totalMinutes).toBeUndefined();
  });
});

describe('fromDetentions', () => {
  const detentions = [
    { placedAt: at('2024-03-07T08:00'), releasedAt: at('2024-03-08T08:00') },
    { placedAt: at('2024-03-08T14:00'), releasedAt: at('2024-03-09T08:00') },
  ];

  it('spans the first placement to the last release', () => {
    const row = fromDetentions('BNSF 400123', detentions);
    expect(row.plantMinutes).toBe(48 * 60);
  });

  it('takes the arrival and the pull from outside', () => {
    const row = fromDetentions('BNSF 400123', detentions, {
      arrivedAt: at('2024-03-06T22:00'),
      pulledAt: at('2024-03-10T08:00'),
    });
    expect(row.yardMinutes).toBe(600);
    expect(row.idleMinutes).toBe(1440);
  });

  it('still reports what it can with no detentions', () => {
    const row = fromDetentions('A', [], {
      arrivedAt: at('2024-03-06T22:00'),
      pulledAt: at('2024-03-10T08:00'),
    });
    expect(row.plantMinutes).toBeUndefined();
    expect(row.totalMinutes).toBe(4920);
  });
});

describe('the statistics', () => {
  it('takes a mean', () => {
    expect(meanMinutes([10, 20, 31])).toBe(20);
    expect(meanMinutes([])).toBeUndefined();
  });

  it('takes a median on an odd and an even count', () => {
    expect(medianMinutes([30, 10, 20])).toBe(20);
    expect(medianMinutes([10, 20, 30, 40])).toBe(25);
    expect(medianMinutes([])).toBeUndefined();
  });

  it('takes a percentile', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentileMinutes(values, 90)).toBe(90);
    expect(percentileMinutes(values, 50)).toBe(50);
    expect(percentileMinutes(values, 1)).toBe(10);
    expect(percentileMinutes([], 90)).toBeUndefined();
  });

  it('handles a single value', () => {
    expect(percentileMinutes([42], 90)).toBe(42);
    expect(medianMinutes([42])).toBe(42);
  });
});

describe('dwellSummary', () => {
  const rows = [
    dwellForCar({ carId: 'A', placedAt: 0, releasedAt: 1440 }),
    dwellForCar({ carId: 'B', placedAt: 0, releasedAt: 2880 }),
    dwellForCar({ carId: 'C', placedAt: 0, releasedAt: 4320 }),
  ];

  it('summarises each stretch separately', () => {
    const summary = dwellSummary(rows);
    expect(summary.plantMinutes.cars).toBe(3);
    expect(summary.plantMinutes.mean).toBe(2880);
    expect(summary.plantMinutes.median).toBe(2880);
    expect(summary.plantMinutes.ninetieth).toBe(4320);
  });

  it('reports nothing for a stretch nobody had', () => {
    const summary = dwellSummary(rows);
    expect(summary.yardMinutes.cars).toBe(0);
    expect(summary.yardMinutes.mean).toBeUndefined();
  });

  it('refuses a non array', () => {
    expect(() => dwellSummary('nope')).toThrow(ValidationError);
  });
});

describe('reading the numbers', () => {
  it('converts minutes to days to two places', () => {
    expect(toDays(1440)).toBe(1);
    expect(toDays(2160)).toBe(1.5);
    expect(toDays(undefined)).toBeUndefined();
  });

  it('lists the worst offenders', () => {
    const rows = [
      dwellForCar({ carId: 'A', arrivedAt: 0, pulledAt: 100 }),
      dwellForCar({ carId: 'B', arrivedAt: 0, pulledAt: 900 }),
      dwellForCar({ carId: 'C', arrivedAt: 0, pulledAt: 500 }),
    ];
    expect(worstDwell(rows).map((row) => row.carId)).toEqual(['B', 'C', 'A']);
  });

  it('leaves out cars it cannot measure', () => {
    const rows = [
      dwellForCar({ carId: 'A' }),
      dwellForCar({ carId: 'B', arrivedAt: 0, pulledAt: 9 }),
    ];
    expect(worstDwell(rows)).toHaveLength(1);
  });
});
