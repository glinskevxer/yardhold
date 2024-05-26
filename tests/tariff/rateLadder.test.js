import { describe, expect, it } from 'vitest';
import {
  LADDER_RESET,
  chargeDays,
  describeLadder,
  flatLadder,
  ladderCeiling,
  rateForDay,
  rateLadder,
  resetsEachDetention,
  rung,
  timesRate,
  totalFor,
} from '../../src/tariff/rateLadder.js';
import { ValidationError } from '../../src/core/errors.js';

const ladder = rateLadder([
  { fromDay: 1, rate: '150.00', toDay: 2 },
  { fromDay: 3, rate: '225.00', toDay: 5 },
  { fromDay: 6, rate: '300.00' },
]);

describe('rung', () => {
  it('parses the rate', () => {
    expect(rung(1, '150.00').rate).toBe(15000);
    expect(rung(1, 15000).rate).toBe(15000);
  });

  it('refuses a negative rate and a backwards range', () => {
    expect(() => rung(1, '-1.00')).toThrow(/cannot be negative/);
    expect(() => rung(3, '150.00', { toDay: 2 })).toThrow(ValidationError);
  });

  it('refuses a day before the first', () => {
    expect(() => rung(0, '150.00')).toThrow(ValidationError);
  });
});

describe('rateLadder', () => {
  it('sorts the rungs', () => {
    const built = rateLadder([
      { fromDay: 3, rate: '225.00' },
      { fromDay: 1, rate: '150.00' },
    ]);
    expect(built.rungs.map((entry) => entry.fromDay)).toEqual([1, 3]);
  });

  it('has to start at day one', () => {
    expect(() => rateLadder([{ fromDay: 2, rate: '150.00' }])).toThrow(/start at the first/);
  });

  it('refuses two rungs on the same day', () => {
    expect(() =>
      rateLadder([
        { fromDay: 1, rate: '150.00' },
        { fromDay: 1, rate: '200.00' },
      ])
    ).toThrow(/same day/);
  });

  it('needs at least one rung', () => {
    expect(() => rateLadder([])).toThrow(ValidationError);
  });

  it('defaults to resetting each detention', () => {
    expect(resetsEachDetention(ladder)).toBe(true);
    expect(
      resetsEachDetention(rateLadder([{ fromDay: 1, rate: '1.00' }], { reset: LADDER_RESET.MONTH }))
    ).toBe(false);
  });

  it('refuses a reset it does not know', () => {
    expect(() => rateLadder([{ fromDay: 1, rate: '1.00' }], { reset: 'quarterly' })).toThrow(
      ValidationError
    );
  });
});

describe('rateForDay', () => {
  it('climbs the ladder', () => {
    expect(rateForDay(ladder, 1)).toBe(15000);
    expect(rateForDay(ladder, 2)).toBe(15000);
    expect(rateForDay(ladder, 3)).toBe(22500);
    expect(rateForDay(ladder, 5)).toBe(22500);
    expect(rateForDay(ladder, 6)).toBe(30000);
    expect(rateForDay(ladder, 40)).toBe(30000);
  });

  it('returns nothing for a day no rung covers', () => {
    const gapped = rateLadder([{ fromDay: 1, rate: '150.00', toDay: 2 }]);
    expect(rateForDay(gapped, 3)).toBe(0);
  });

  it('honours a daily cap', () => {
    const capped = rateLadder(
      [
        { fromDay: 1, rate: '150.00', toDay: 2 },
        { fromDay: 3, rate: '400.00' },
      ],
      { dailyCap: '250.00' }
    );
    expect(rateForDay(capped, 1)).toBe(15000);
    expect(rateForDay(capped, 3)).toBe(25000);
  });

  it('refuses a day index below one', () => {
    expect(() => rateForDay(ladder, 0)).toThrow(ValidationError);
  });
});

describe('charging a run of days', () => {
  it('lists a line for each day', () => {
    expect(chargeDays(ladder, 4)).toEqual([
      { dayIndex: 1, rate: 15000 },
      { dayIndex: 2, rate: 15000 },
      { dayIndex: 3, rate: 22500 },
      { dayIndex: 4, rate: 22500 },
    ]);
  });

  it('totals them', () => {
    expect(totalFor(ladder, 4)).toBe(75000);
    expect(totalFor(ladder, 0)).toBe(0);
  });

  it('starts partway up the ladder when the month carries over', () => {
    expect(chargeDays(ladder, 2, { startIndex: 5 })).toEqual([
      { dayIndex: 5, rate: 22500 },
      { dayIndex: 6, rate: 30000 },
    ]);
    expect(totalFor(ladder, 2, { startIndex: 5 })).toBe(52500);
  });

  it('charges the same two days differently depending on where they start', () => {
    expect(totalFor(ladder, 2)).toBe(30000);
    expect(totalFor(ladder, 2, { startIndex: 6 })).toBe(60000);
  });

  it('refuses a negative count', () => {
    expect(() => chargeDays(ladder, -1)).toThrow(ValidationError);
  });
});

describe('helpers', () => {
  it('builds a flat ladder', () => {
    const flat = flatLadder('75.00');
    expect(rateForDay(flat, 1)).toBe(7500);
    expect(rateForDay(flat, 20)).toBe(7500);
  });

  it('finds the top rate', () => {
    expect(ladderCeiling(ladder)).toBe(30000);
  });

  it('multiplies a rate by a count', () => {
    expect(timesRate(15000, 3)).toBe(45000);
  });

  it('describes the rungs', () => {
    expect(describeLadder(ladder)).toBe('1-2 at 15000, 3-5 at 22500, 6+ at 30000');
  });
});
