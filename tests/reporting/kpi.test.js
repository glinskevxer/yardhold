import { describe, expect, it } from 'vitest';
import {
  assessmentKpis,
  comparePeriods,
  grossPerCarRounded,
  reliefKpis,
} from '../../src/reporting/kpi.js';
import { ValidationError } from '../../src/core/errors.js';

const assessment = ({
  carId,
  chargeableDays = 0,
  freeUsed = 1,
  gross = 0,
  detentions = [{ startsAt: 0 }],
  applied = [],
  declined = [],
}) => ({
  carId,
  chargeableDays,
  gross,
  detentions,
  counts: [{ freeUsed, relief: { applied, declined } }],
});

const month = [
  assessment({ carId: 'A', chargeableDays: 3, gross: 45000 }),
  assessment({ carId: 'B', chargeableDays: 0, gross: 0 }),
  assessment({
    carId: 'C',
    chargeableDays: 1,
    gross: 15000,
    detentions: [{ startsAt: 0 }, { startsAt: 5 }],
  }),
  assessment({ carId: 'D', detentions: [{ startsAt: undefined }] }),
];

describe('assessmentKpis', () => {
  const kpis = assessmentKpis(month);

  it('counts the cars and the ones that had a clock', () => {
    expect(kpis.cars).toBe(4);
    expect(kpis.carsWithAClock).toBe(3);
  });

  it('leaves the never notified car out of the denominator', () => {
    expect(kpis.carsOverFreeTime).toBe(2);
    expect(kpis.overFreeTimeShare).toBeCloseTo(2 / 3, 6);
  });

  it('adds up the days', () => {
    expect(kpis.chargeableDays).toBe(4);
    expect(kpis.freeDays).toBe(4);
  });

  it('counts the respots', () => {
    expect(kpis.respots).toBe(1);
  });

  it('totals and averages the money', () => {
    expect(kpis.gross).toBe(60000);
    expect(kpis.averagePerCar).toBe(15000);
  });

  it('averages the chargeable days over the cars that had a clock', () => {
    expect(kpis.averageChargeableDays).toBe(1.33);
  });

  it('handles an empty month without dividing by zero', () => {
    const empty = assessmentKpis([]);
    expect(empty.overFreeTimeShare).toBe(0);
    expect(empty.averagePerCar).toBe(0);
    expect(empty.averageChargeableDays).toBe(0);
  });

  it('refuses a non array', () => {
    expect(() => assessmentKpis('nope')).toThrow(ValidationError);
  });
});

describe('reliefKpis', () => {
  const withRelief = [
    assessment({
      carId: 'A',
      applied: [{ kind: 'weather' }],
      declined: [{ kind: 'plant-closure' }],
    }),
    assessment({ carId: 'B', applied: [{ kind: 'weather' }, { kind: 'bad-order' }] }),
  ];

  it('counts both sides', () => {
    const kpis = reliefKpis(withRelief);
    expect(kpis.applied).toBe(3);
    expect(kpis.declined).toBe(1);
  });

  it('reports the acceptance rate', () => {
    expect(reliefKpis(withRelief).acceptanceRate).toBe(0.75);
  });

  it('groups what was applied by kind', () => {
    expect(reliefKpis(withRelief).byKind).toEqual({ 'bad-order': 1, weather: 2 });
  });

  it('is zero when there was no relief at all', () => {
    const kpis = reliefKpis(month);
    expect(kpis.acceptanceRate).toBe(0);
    expect(kpis.byKind).toEqual({});
  });
});

describe('comparePeriods', () => {
  const before = assessmentKpis(month);
  const after = assessmentKpis([
    ...month,
    assessment({ carId: 'E', chargeableDays: 2, gross: 30000 }),
  ]);

  it('reports the movement in each figure', () => {
    const delta = comparePeriods(before, after);
    expect(delta.cars).toBe(1);
    expect(delta.chargeableDays).toBe(2);
    expect(delta.gross).toBe(30000);
  });

  it('reports the movement as a percentage to one place', () => {
    expect(comparePeriods(before, after).grossPercent).toBe(50);
    expect(comparePeriods(before, after).carsPercent).toBe(25);
  });

  it('reports null rather than infinity when the base was zero', () => {
    const zero = assessmentKpis([]);
    expect(comparePeriods(zero, after).grossPercent).toBeNull();
  });
});

describe('grossPerCarRounded', () => {
  it('splits the gross', () => {
    expect(grossPerCarRounded({ gross: 60000 }, 4)).toBe(15000);
  });

  it('never divides by zero', () => {
    expect(grossPerCarRounded({ gross: 60000 }, 0)).toBe(60000);
  });
});
