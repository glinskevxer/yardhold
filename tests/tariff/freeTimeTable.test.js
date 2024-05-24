import { describe, expect, it } from 'vitest';
import {
  DAY_KIND,
  SERVICE,
  countsServiceDaysOnly,
  describeFreeTime,
  freeDays,
  freeTimeDayKind,
  freeTimeEntry,
  freeTimeTable,
  lookupFreeTime,
} from '../../src/tariff/freeTimeTable.js';
import { ValidationError } from '../../src/core/errors.js';

const table = freeTimeTable([
  { service: SERVICE.UNLOADING, days: 1 },
  { service: SERVICE.LOADING, days: 1 },
  { service: SERVICE.UNLOADING, days: 2, carKind: 'tank' },
  { service: SERVICE.UNLOADING, days: 5, carKind: 'tank', commodityClass: 'HAZ' },
  { service: SERVICE.UNLOADING, days: 3, commodityClass: 'GRAIN', dayKind: DAY_KIND.SERVICE },
]);

describe('freeTimeEntry', () => {
  it('scores its own specificity', () => {
    expect(freeTimeEntry({ service: SERVICE.LOADING, days: 1 }).specificity).toBe(0);
    expect(
      freeTimeEntry({ service: SERVICE.LOADING, days: 1, commodityClass: 'X' }).specificity
    ).toBe(1);
    expect(freeTimeEntry({ service: SERVICE.LOADING, days: 1, carKind: 'tank' }).specificity).toBe(
      2
    );
    expect(
      freeTimeEntry({ service: SERVICE.LOADING, days: 1, carKind: 'tank', commodityClass: 'X' })
        .specificity
    ).toBe(3);
  });

  it('defaults to counting running days', () => {
    expect(freeTimeEntry({ service: SERVICE.LOADING, days: 1 }).dayKind).toBe(DAY_KIND.RUNNING);
  });

  it('refuses a service or a day kind it does not know', () => {
    expect(() => freeTimeEntry({ service: 'washing', days: 1 })).toThrow(ValidationError);
    expect(() => freeTimeEntry({ service: SERVICE.LOADING, days: 1, dayKind: 'lunar' })).toThrow(
      ValidationError
    );
  });

  it('refuses an allowance outside the range', () => {
    expect(() => freeTimeEntry({ service: SERVICE.LOADING, days: -1 })).toThrow(ValidationError);
    expect(() => freeTimeEntry({ service: SERVICE.LOADING, days: 61 })).toThrow(ValidationError);
  });
});

describe('freeTimeTable', () => {
  it('sorts the most specific entries first', () => {
    expect(table[0].specificity).toBe(3);
    expect(table[table.length - 1].specificity).toBe(0);
  });

  it('refuses the same combination twice', () => {
    expect(() =>
      freeTimeTable([
        { service: SERVICE.LOADING, days: 1 },
        { service: SERVICE.LOADING, days: 2 },
      ])
    ).toThrow(/same combination twice/);
  });

  it('lets the same days sit under two services', () => {
    expect(
      freeTimeTable([
        { service: SERVICE.LOADING, days: 1 },
        { service: SERVICE.UNLOADING, days: 1 },
      ])
    ).toHaveLength(2);
  });
});

describe('lookup', () => {
  it('falls back to the bare service line', () => {
    expect(freeDays(table, { service: SERVICE.UNLOADING, carKind: 'boxcar' })).toBe(1);
  });

  it('prefers the car kind line', () => {
    expect(freeDays(table, { service: SERVICE.UNLOADING, carKind: 'tank' })).toBe(2);
  });

  it('prefers the car kind and commodity line over both', () => {
    expect(
      freeDays(table, { service: SERVICE.UNLOADING, carKind: 'tank', commodityClass: 'HAZ' })
    ).toBe(5);
  });

  it('takes the commodity line when the car kind does not match', () => {
    expect(
      freeDays(table, { service: SERVICE.UNLOADING, carKind: 'hopper', commodityClass: 'GRAIN' })
    ).toBe(3);
  });

  it('returns the fallback when nothing matches', () => {
    expect(freeDays(table, { service: SERVICE.HELD }, 0)).toBe(0);
    expect(lookupFreeTime(table, { service: SERVICE.HELD })).toBeUndefined();
  });

  it('refuses a service it does not know', () => {
    expect(() => lookupFreeTime(table, { service: 'washing' })).toThrow(ValidationError);
  });
});

describe('what the entry says the days mean', () => {
  it('reads the day kind off the winning entry', () => {
    expect(freeTimeDayKind(table, { service: SERVICE.UNLOADING, carKind: 'boxcar' })).toBe(
      DAY_KIND.RUNNING
    );
    expect(freeTimeDayKind(table, { service: SERVICE.UNLOADING, commodityClass: 'GRAIN' })).toBe(
      DAY_KIND.SERVICE
    );
  });

  it('lets the commodity change what the calendar means for the same car', () => {
    const grain = { service: SERVICE.UNLOADING, carKind: 'hopper', commodityClass: 'GRAIN' };
    const cement = { service: SERVICE.UNLOADING, carKind: 'hopper', commodityClass: 'CEMENT' };
    expect(countsServiceDaysOnly(table, grain)).toBe(true);
    expect(countsServiceDaysOnly(table, cement)).toBe(false);
  });

  it('falls back to running days when nothing matches', () => {
    expect(freeTimeDayKind(table, { service: SERVICE.HELD })).toBe(DAY_KIND.RUNNING);
  });
});

describe('describeFreeTime', () => {
  it('reads a bare line', () => {
    expect(describeFreeTime(freeTimeEntry({ service: SERVICE.LOADING, days: 1 }))).toBe(
      '1 running days loading'
    );
  });

  it('names the scope when there is one', () => {
    const entry = freeTimeEntry({
      service: SERVICE.UNLOADING,
      days: 5,
      carKind: 'tank',
      commodityClass: 'HAZ',
    });
    expect(describeFreeTime(entry)).toBe('5 running days unloading for tank HAZ');
  });
});
