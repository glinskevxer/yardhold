import { describe, expect, it } from 'vitest';
import {
  effectiveDates,
  effectiveEntry,
  effectiveSeries,
  entryOn,
  isCoveredOn,
  supersededOn,
  valueOn,
} from '../../src/tariff/effectivity.js';
import { ConflictError, ValidationError } from '../../src/core/errors.js';

const series = effectiveSeries([
  { effectiveFrom: '2024-07-01', value: 'B' },
  { effectiveFrom: '2024-01-01', value: 'A' },
  { effectiveFrom: '2025-01-01', value: 'C' },
]);

describe('effectiveEntry', () => {
  it('parses both ends', () => {
    const entry = effectiveEntry('2024-01-01', 'A', { effectiveTo: '2024-06-30' });
    expect(entry.from.month).toBe(1);
    expect(entry.to.day).toBe(30);
  });

  it('leaves the end open', () => {
    expect(effectiveEntry('2024-01-01', 'A').to).toBeUndefined();
  });

  it('refuses an entry that expires before it starts', () => {
    expect(() => effectiveEntry('2024-07-01', 'A', { effectiveTo: '2024-01-01' })).toThrow(
      ValidationError
    );
  });
});

describe('effectiveSeries', () => {
  it('sorts by effective date', () => {
    expect(effectiveDates(series)).toEqual(['2024-01-01', '2024-07-01', '2025-01-01']);
  });

  it('refuses two pages taking effect the same day', () => {
    expect(() =>
      effectiveSeries([
        { effectiveFrom: '2024-01-01', value: 'A' },
        { effectiveFrom: '2024-01-01', value: 'B' },
      ])
    ).toThrow(ConflictError);
  });

  it('takes already built entries', () => {
    const built = effectiveSeries([effectiveEntry('2024-01-01', 'A')]);
    expect(built).toHaveLength(1);
  });

  it('is empty for no entries', () => {
    expect(effectiveSeries()).toEqual([]);
  });
});

describe('entryOn', () => {
  it('picks the latest page on or before the day', () => {
    expect(valueOn(series, '2024-06-30')).toBe('A');
    expect(valueOn(series, '2024-07-01')).toBe('B');
    expect(valueOn(series, '2024-12-31')).toBe('B');
    expect(valueOn(series, '2026-01-01')).toBe('C');
  });

  it('has nothing before the first page', () => {
    expect(entryOn(series, '2023-12-31')).toBeUndefined();
    expect(isCoveredOn(series, '2023-12-31')).toBe(false);
    expect(valueOn(series, '2023-12-31', 'none')).toBe('none');
  });

  it('skips a page that has expired', () => {
    const closed = effectiveSeries([
      { effectiveFrom: '2024-01-01', value: 'A', effectiveTo: '2024-03-31' },
    ]);
    expect(valueOn(closed, '2024-03-31')).toBe('A');
    expect(entryOn(closed, '2024-04-01')).toBeUndefined();
  });

  it('takes a parsed date as well as text', () => {
    expect(valueOn(series, { year: 2024, month: 8, day: 1 })).toBe('B');
  });
});

describe('supersededOn', () => {
  it('names the day the next page takes over', () => {
    expect(supersededOn(series, 0)).toBe('2024-07-01');
    expect(supersededOn(series, 1)).toBe('2025-01-01');
  });

  it('is open for the last page', () => {
    expect(supersededOn(series, 2)).toBeUndefined();
  });

  it('uses the explicit end when there is no next page', () => {
    const closed = effectiveSeries([
      { effectiveFrom: '2024-01-01', value: 'A', effectiveTo: '2024-03-31' },
    ]);
    expect(supersededOn(closed, 0)).toBe('2024-03-31');
  });

  it('is undefined past the end of the series', () => {
    expect(supersededOn(series, 9)).toBeUndefined();
  });
});
