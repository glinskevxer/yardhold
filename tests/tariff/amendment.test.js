import { describe, expect, it } from 'vitest';
import {
  AMENDS,
  pageAsAmended,
  supplement,
  supplementNumbers,
  supplementSeries,
  supplementsInForce,
} from '../../src/tariff/amendment.js';
import { tariff } from '../../src/tariff/tariff.js';
import { rateForDay } from '../../src/tariff/rateLadder.js';
import { SERVICE, freeDays } from '../../src/tariff/freeTimeTable.js';
import { ConflictError, ValidationError } from '../../src/core/errors.js';

const page = tariff({
  id: 'DEM-4000',
  carrier: 'BNSF',
  ladder: [{ fromDay: 1, rate: '150.00' }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
});

const raise = {
  number: 'SUPP-3',
  pageId: 'DEM-4000',
  amends: AMENDS.LADDER,
  effectiveFrom: '2024-03-01',
  ladder: [{ fromDay: 1, rate: '200.00' }],
};

const lowerBack = {
  number: 'SUPP-5',
  pageId: 'DEM-4000',
  amends: AMENDS.LADDER,
  effectiveFrom: '2024-06-01',
  ladder: [{ fromDay: 1, rate: '150.00' }],
};

const moreFreeTime = {
  number: 'SUPP-4',
  pageId: 'DEM-4000',
  amends: AMENDS.FREE_TIME,
  effectiveFrom: '2024-04-01',
  freeTime: [{ service: SERVICE.UNLOADING, days: 3 }],
};

describe('supplement', () => {
  it('builds the ladder it carries', () => {
    expect(rateForDay(supplement(raise).ladder, 1)).toBe(20000);
  });

  it('makes each kind carry what it amends', () => {
    expect(() => supplement({ ...raise, ladder: undefined })).toThrow(/carry a ladder/);
    expect(() => supplement({ ...moreFreeTime, freeTime: undefined })).toThrow(/carry a table/);
    expect(() => supplement({ ...raise, amends: AMENDS.SETTINGS, ladder: undefined })).toThrow(
      /carry settings/
    );
  });

  it('needs a number, a page and a date', () => {
    expect(() => supplement({ ...raise, number: undefined })).toThrow(ValidationError);
    expect(() => supplement({ ...raise, pageId: undefined })).toThrow(ValidationError);
    expect(() => supplement({ ...raise, effectiveFrom: undefined })).toThrow(ValidationError);
  });

  it('refuses a kind it does not know', () => {
    expect(() => supplement({ ...raise, amends: 'colour' })).toThrow(ValidationError);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(supplement(raise))).toBe(true);
  });
});

describe('supplementSeries', () => {
  const series = supplementSeries([lowerBack, raise, moreFreeTime]);

  it('sorts by effective date', () => {
    expect(series.map((entry) => entry.number)).toEqual(['SUPP-3', 'SUPP-4', 'SUPP-5']);
  });

  it('refuses the same number filed twice against a page', () => {
    expect(() => supplementSeries([raise, raise])).toThrow(ConflictError);
  });

  it('allows the same number against different pages', () => {
    expect(supplementSeries([raise, { ...raise, pageId: 'DEM-4100' }])).toHaveLength(2);
  });

  it('lists the numbers filed against a page', () => {
    expect(supplementNumbers(series, 'DEM-4000')).toEqual(['SUPP-3', 'SUPP-4', 'SUPP-5']);
    expect(supplementNumbers(series, 'DEM-4100')).toEqual([]);
  });
});

describe('supplementsInForce', () => {
  const series = supplementSeries([lowerBack, raise, moreFreeTime]);

  it('has none before the first', () => {
    expect(supplementsInForce(series, 'DEM-4000', '2024-02-01')).toEqual([]);
  });

  it('gathers everything up to the day', () => {
    expect(
      supplementsInForce(series, 'DEM-4000', '2024-05-01').map((entry) => entry.number)
    ).toEqual(['SUPP-3', 'SUPP-4']);
  });

  it('includes one taking effect that very day', () => {
    expect(supplementsInForce(series, 'DEM-4000', '2024-03-01')).toHaveLength(1);
  });
});

describe('a supplement that was cancelled', () => {
  const cancelled = {
    number: 'SUPP-7',
    pageId: 'DEM-4000',
    amends: AMENDS.LADDER,
    effectiveFrom: '2024-03-01',
    effectiveTo: '2024-04-30',
    ladder: [{ fromDay: 1, rate: '500.00' }],
  };

  it('carries both ends', () => {
    const built = supplement(cancelled);
    expect(built.effectiveFrom).toBe('2024-03-01');
    expect(built.effectiveTo).toBe('2024-04-30');
  });

  it('refuses one cancelled before it took effect', () => {
    expect(() => supplement({ ...cancelled, effectiveTo: '2024-02-01' })).toThrow(
      /cancelled before it takes effect/
    );
  });

  it('is in force inside its window', () => {
    const series = supplementSeries([cancelled]);
    expect(supplementsInForce(series, 'DEM-4000', '2024-04-01')).toHaveLength(1);
  });

  it('stops being in force after it was cancelled', () => {
    const series = supplementSeries([cancelled]);
    expect(supplementsInForce(series, 'DEM-4000', '2024-05-01')).toEqual([]);
  });

  it('stops being laid over the page after it was cancelled', () => {
    const series = supplementSeries([cancelled]);
    expect(rateForDay(pageAsAmended(page, series, '2024-04-01').page.ladder, 1)).toBe(50000);
    expect(rateForDay(pageAsAmended(page, series, '2024-05-01').page.ladder, 1)).toBe(15000);
  });

  it('leaves a supplement with no end date in force', () => {
    const series = supplementSeries([raise]);
    expect(supplementsInForce(series, 'DEM-4000', '2099-01-01')).toHaveLength(1);
  });
});

describe('pageAsAmended', () => {
  const series = supplementSeries([lowerBack, raise, moreFreeTime]);

  it('leaves the page alone before any supplement', () => {
    const result = pageAsAmended(page, series, '2024-02-01');
    expect(result.page).toBe(page);
    expect(result.applied).toEqual([]);
  });

  it('applies the rate rise', () => {
    const result = pageAsAmended(page, series, '2024-03-15');
    expect(rateForDay(result.page.ladder, 1)).toBe(20000);
    expect(result.applied).toEqual(['SUPP-3']);
  });

  it('applies the free time change on top of it', () => {
    const result = pageAsAmended(page, series, '2024-04-15');
    expect(rateForDay(result.page.ladder, 1)).toBe(20000);
    expect(freeDays(result.page.freeTime, { service: SERVICE.UNLOADING })).toBe(3);
  });

  it('lands back where it started once the rate is put back', () => {
    const result = pageAsAmended(page, series, '2024-07-01');
    expect(rateForDay(result.page.ladder, 1)).toBe(15000);
    expect(result.applied).toEqual(['SUPP-3', 'SUPP-4', 'SUPP-5']);
  });

  it('gets it wrong if only the latest is applied, which is the point', () => {
    const onlyLatest = pageAsAmended(page, supplementSeries([moreFreeTime]), '2024-07-01');
    expect(rateForDay(onlyLatest.page.ladder, 1)).toBe(15000);
    const inOrder = pageAsAmended(page, series, '2024-05-01');
    expect(rateForDay(inOrder.page.ladder, 1)).toBe(20000);
  });

  it('keeps the rest of the page', () => {
    const result = pageAsAmended(page, series, '2024-03-15');
    expect(result.page.id).toBe('DEM-4000');
    expect(result.page.carrier).toBe('BNSF');
    expect(result.page.notificationRequired).toBe(page.notificationRequired);
  });

  it('applies a settings supplement', () => {
    const settings = supplementSeries([
      {
        number: 'SUPP-9',
        pageId: 'DEM-4000',
        amends: AMENDS.SETTINGS,
        effectiveFrom: '2024-03-01',
        settings: { notificationRequired: false, bunchingRelief: true },
      },
    ]);
    const result = pageAsAmended(page, settings, '2024-04-01');
    expect(result.page.notificationRequired).toBe(false);
    expect(result.page.bunchingRelief).toBe(true);
  });

  it('ignores supplements filed against another page', () => {
    const other = supplementSeries([{ ...raise, pageId: 'DEM-4100' }]);
    expect(pageAsAmended(page, other, '2024-07-01').applied).toEqual([]);
  });
});
