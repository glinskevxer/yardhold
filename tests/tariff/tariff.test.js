import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUNCHING_CAP_DAYS,
  DEFAULT_SERVICES,
  DEFAULT_STORAGE_FREE_DAYS,
  chargeableUnitOptions,
  countsInWholeDays,
  describeTariff,
  freeTimeCountsServiceDays,
  freeTimeFor,
  laddersResetPerDetention,
  tariff,
} from '../../src/tariff/tariff.js';
import { COUNT_BASIS } from '../../src/time/dayCount.js';
import { DAY_KIND, SERVICE } from '../../src/tariff/freeTimeTable.js';
import { LADDER_RESET, rateLadder } from '../../src/tariff/rateLadder.js';
import { ValidationError } from '../../src/core/errors.js';

const base = {
  id: 'DEM-4000',
  carrier: 'bnsf',
  ladder: [
    { fromDay: 1, rate: '150.00', toDay: 2 },
    { fromDay: 3, rate: '225.00' },
  ],
  freeTime: [
    { service: SERVICE.UNLOADING, days: 1 },
    { service: SERVICE.UNLOADING, days: 3, commodityClass: 'GRAIN', dayKind: DAY_KIND.SERVICE },
  ],
};

describe('building a page', () => {
  it('normalises the carrier and titles itself', () => {
    const page = tariff(base);
    expect(page.carrier).toBe('BNSF');
    expect(page.title).toBe('DEM-4000');
  });

  it('builds the free time table and the ladder from plain arrays', () => {
    const page = tariff(base);
    expect(page.freeTime).toHaveLength(2);
    expect(page.ladder.rungs).toHaveLength(2);
  });

  it('takes an already built ladder', () => {
    const built = rateLadder([{ fromDay: 1, rate: '75.00' }]);
    expect(tariff({ ...base, ladder: built }).ladder).toBe(built);
  });

  it('needs a ladder', () => {
    expect(() => tariff({ ...base, ladder: undefined })).toThrow(/needs a rate ladder/);
  });

  it('needs an id and a carrier', () => {
    expect(() => tariff({ ...base, id: undefined })).toThrow(ValidationError);
    expect(() => tariff({ ...base, carrier: undefined })).toThrow(ValidationError);
  });

  it('refuses a counting basis it does not know', () => {
    expect(() => tariff({ ...base, countBasis: 'weekly' })).toThrow(ValidationError);
  });

  it('refuses a page that counts service days but names none', () => {
    expect(() =>
      tariff({
        ...base,
        excludeDayKind: DAY_KIND.SERVICE,
        observesHolidays: false,
        creditsWeekends: false,
      })
    ).toThrow(/which days are not service days/);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(tariff(base))).toBe(true);
  });
});

describe('defaults', () => {
  const page = tariff(base);

  it('counts calendar days and requires notification', () => {
    expect(page.countBasis).toBe(COUNT_BASIS.CALENDAR_DAY);
    expect(page.notificationRequired).toBe(true);
  });

  it('gives no bunching relief and no average agreement', () => {
    expect(page.bunchingRelief).toBe(false);
    expect(page.averageAgreementAllowed).toBe(false);
  });

  it('has no minimum charge and no storage ladder', () => {
    expect(page.minimumCharge).toBe(0);
    expect(page.storageLadder).toBeUndefined();
  });
});

describe('what the page decides', () => {
  const page = tariff(base);

  it('answers the free time for a query', () => {
    expect(freeTimeFor(page, { service: SERVICE.UNLOADING, carKind: 'boxcar' })).toBe(1);
    expect(freeTimeFor(page, { service: SERVICE.UNLOADING, commodityClass: 'GRAIN' })).toBe(3);
  });

  it('is zero for a service the page does not cover', () => {
    expect(freeTimeFor(page, { service: SERVICE.HELD })).toBe(0);
  });

  it('says which queries count service days only', () => {
    expect(freeTimeCountsServiceDays(page, { service: SERVICE.UNLOADING })).toBe(false);
    expect(
      freeTimeCountsServiceDays(page, { service: SERVICE.UNLOADING, commodityClass: 'GRAIN' })
    ).toBe(true);
  });

  it('says whether exclusions come off in whole days', () => {
    expect(countsInWholeDays(page)).toBe(true);
    expect(
      countsInWholeDays(
        tariff({ ...base, excludeDayKind: DAY_KIND.SERVICE, creditsWeekends: true })
      )
    ).toBe(false);
  });

  it('says whether the ladder restarts at each placement', () => {
    expect(laddersResetPerDetention(page)).toBe(true);
    const monthly = tariff({
      ...base,
      ladder: rateLadder([{ fromDay: 1, rate: '1.00' }], { reset: LADDER_RESET.MONTH }),
    });
    expect(laddersResetPerDetention(monthly)).toBe(false);
  });
});

describe('chargeableUnitOptions', () => {
  it('drops a partial first day on the calendar basis', () => {
    expect(chargeableUnitOptions(tariff(base)).countPartialFirst).toBe(false);
  });

  it('keeps it on the rolling basis', () => {
    const page = tariff({ ...base, countBasis: COUNT_BASIS.TWENTY_FOUR_HOUR });
    expect(chargeableUnitOptions(page)).toEqual({
      basis: COUNT_BASIS.TWENTY_FOUR_HOUR,
      countPartialFirst: true,
      countPartialLast: true,
    });
  });
});

describe('describeTariff', () => {
  it('reads the carrier, the number and the title', () => {
    expect(describeTariff(tariff({ ...base, title: 'Demurrage' }))).toBe('BNSF DEM-4000 Demurrage');
  });

  it('ships the two services a page normally covers', () => {
    expect(DEFAULT_SERVICES).toEqual([SERVICE.LOADING, SERVICE.UNLOADING]);
  });
});

describe('the relief allowances the page carries', () => {
  it('caps bunching relief at the public figure by default', () => {
    expect(tariff(base).bunchingCapDays).toBe(DEFAULT_BUNCHING_CAP_DAYS);
  });

  it('takes a cap of its own', () => {
    expect(tariff({ ...base, bunchingCapDays: 2 }).bunchingCapDays).toBe(2);
  });

  it('allows a page that gives no bunching relief at all', () => {
    expect(tariff({ ...base, bunchingCapDays: 0 }).bunchingCapDays).toBe(0);
  });

  it('refuses a cap beyond a month', () => {
    expect(() => tariff({ ...base, bunchingCapDays: 31 })).toThrow(ValidationError);
    expect(() => tariff({ ...base, bunchingCapDays: -1 })).toThrow(ValidationError);
  });

  it('carries the storage free days for both load states', () => {
    expect(tariff(base).storageFreeDays).toEqual(DEFAULT_STORAGE_FREE_DAYS);
  });

  it('freezes the storage table', () => {
    expect(Object.isFrozen(tariff(base).storageFreeDays)).toBe(true);
  });

  it('takes a storage table of its own', () => {
    const page = tariff({ ...base, storageFreeDays: { loaded: 5, empty: 1 } });
    expect(page.storageFreeDays).toEqual({ loaded: 5, empty: 1 });
  });

  it('refuses a storage table with a missing half', () => {
    expect(() => tariff({ ...base, storageFreeDays: { loaded: 5 } })).toThrow(ValidationError);
  });

  it('refuses a storage allowance beyond a month', () => {
    expect(() => tariff({ ...base, storageFreeDays: { loaded: 60, empty: 0 } })).toThrow(
      ValidationError
    );
  });
});
