import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FREE_DAYS,
  LOAD_STATE,
  assessStorage,
  isEmptyStorage,
  storageDates,
  storageFreeDays,
  storageTotal,
} from '../../src/storage/storageCharge.js';
import { tariff } from '../../src/tariff/tariff.js';
import { serviceCalendar } from '../../src/time/serviceCalendar.js';
import { parseInstant } from '../../src/time/instant.js';
import { period } from '../../src/time/period.js';
import { ValidationError } from '../../src/core/errors.js';

const at = (text) => parseInstant(text, -360);
const calendar = serviceCalendar({ id: 'MEM', years: [2024] });
const span = period(at('2024-03-04T00:00'), at('2024-03-10T00:00'));

const page = tariff({
  id: 'DEM-4000',
  carrier: 'BNSF',
  ladder: [{ fromDay: 1, rate: '150.00' }],
  storageLadder: [
    { fromDay: 1, rate: '60.00', toDay: 3 },
    { fromDay: 4, rate: '90.00' },
  ],
});

describe('storageFreeDays', () => {
  it('gives a loaded car two days and an empty one none', () => {
    expect(storageFreeDays(page, LOAD_STATE.LOADED)).toBe(2);
    expect(storageFreeDays(page, LOAD_STATE.EMPTY)).toBe(0);
  });

  it('takes a table off the page', () => {
    const custom = { ...page, storageFreeDays: { loaded: 4, empty: 1 } };
    expect(storageFreeDays(custom, LOAD_STATE.LOADED)).toBe(4);
    expect(storageFreeDays(custom, LOAD_STATE.EMPTY)).toBe(1);
  });

  it('ships a default table', () => {
    expect(DEFAULT_FREE_DAYS.loaded).toBe(2);
  });

  it('refuses a load state it does not know', () => {
    expect(() => storageFreeDays(page, 'partial')).toThrow(ValidationError);
  });
});

describe('assessing a loaded car', () => {
  const result = assessStorage({ carId: 'GATX 77', span, page, calendar });

  it('spends the free days then charges', () => {
    expect(result.freeDays).toBe(2);
    expect(storageDates(result)).toEqual(['2024-03-06', '2024-03-07', '2024-03-08', '2024-03-09']);
  });

  it('climbs the storage ladder rather than the demurrage one', () => {
    expect(result.lines.map((line) => line.rate)).toEqual([6000, 6000, 6000, 9000]);
    expect(storageTotal(result)).toBe(27000);
  });

  it('numbers the days from one', () => {
    expect(result.lines.map((line) => line.dayIndex)).toEqual([1, 2, 3, 4]);
    expect(result.nextIndex).toBe(5);
  });
});

describe('assessing an empty car', () => {
  const result = assessStorage({
    carId: 'GATX 77',
    span,
    page,
    calendar,
    loadState: LOAD_STATE.EMPTY,
  });

  it('charges from the first day', () => {
    expect(result.freeDays).toBe(0);
    expect(result.chargeableDays).toBe(6);
    expect(isEmptyStorage(result)).toBe(true);
  });

  it('costs more than the same stand loaded', () => {
    const loaded = assessStorage({ carId: 'GATX 77', span, page, calendar });
    expect(result.total).toBeGreaterThan(loaded.total);
  });
});

describe('edges', () => {
  it('falls back to the demurrage ladder when there is no storage one', () => {
    const bare = tariff({ id: 'X', carrier: 'BNSF', ladder: [{ fromDay: 1, rate: '150.00' }] });
    const result = assessStorage({ carId: 'GATX 77', span, page: bare, calendar });
    expect(result.lines[0].rate).toBe(15000);
  });

  it('charges nothing for no span', () => {
    const result = assessStorage({ carId: 'GATX 77', page, calendar });
    expect(result.total).toBe(0);
    expect(result.lines).toEqual([]);
  });

  it('can start partway up the ladder', () => {
    const result = assessStorage({ carId: 'GATX 77', span, page, calendar, startIndex: 3 });
    expect(result.lines.map((line) => line.dayIndex)).toEqual([3, 4, 5, 6]);
  });

  it('needs a page', () => {
    expect(() => assessStorage({ carId: 'GATX 77', span })).toThrow(ValidationError);
  });

  it('reports an empty result as vacuously empty state', () => {
    expect(isEmptyStorage(assessStorage({ carId: 'GATX 77', page }))).toBe(true);
  });
});
