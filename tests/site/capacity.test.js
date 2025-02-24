import { describe, expect, it } from 'vitest';
import {
  averageOccupancy,
  firstSpareDay,
  fullDays,
  nextDay,
  occupancyByDay,
  occupancyFor,
  peakOccupancy,
  trackOccupancy,
  utilisation,
  wasFullOn,
} from '../../src/site/capacity.js';
import { trackBook } from '../../src/site/track.js';
import { NotFoundError, ValidationError } from '../../src/core/errors.js';

const track = {
  id: 'IT-9',
  splc: '412300',
  name: 'Delta lead',
  capacityCars: 2,
  consigneeId: 'DELTA',
};

const book = trackBook([track]);
const window = { from: '2024-03-04', to: '2024-03-08' };

const placements = [
  { carId: 'A', trackId: 'IT-9', placedOn: '2024-03-04', releasedOn: '2024-03-06' },
  { carId: 'B', trackId: 'IT-9', placedOn: '2024-03-05', releasedOn: '2024-03-07' },
  { carId: 'C', trackId: 'IT-14', placedOn: '2024-03-04', releasedOn: '2024-03-08' },
];

describe('occupancyByDay', () => {
  it('counts a car on every day it stood', () => {
    const counts = occupancyByDay([placements[0]], window);
    expect(counts.get('2024-03-04')).toBe(1);
    expect(counts.get('2024-03-06')).toBe(1);
    expect(counts.get('2024-03-07')).toBe(0);
    expect(counts.get('2024-03-05')).toBe(1);
  });

  it('runs an unreleased car to the end of the window', () => {
    const counts = occupancyByDay([{ trackId: 'IT-9', placedOn: '2024-03-04' }], window);
    expect(counts.get('2024-03-08')).toBe(1);
  });

  it('ignores a car that stood entirely outside the window', () => {
    const counts = occupancyByDay(
      [{ trackId: 'IT-9', placedOn: '2024-01-01', releasedOn: '2024-01-05' }],
      window
    );
    expect([...counts.values()].every((value) => value === 0)).toBe(true);
  });

  it('covers every day in the window even the empty ones', () => {
    expect(occupancyByDay([], window).size).toBe(5);
  });

  it('needs a window', () => {
    expect(() => occupancyByDay([], {})).toThrow(/needs a window/);
  });

  it('refuses a backwards window', () => {
    expect(() => occupancyByDay([], { from: '2024-03-08', to: '2024-03-04' })).toThrow(
      /end before it starts/
    );
  });

  it('refuses a non array', () => {
    expect(() => occupancyByDay('nope', window)).toThrow(ValidationError);
  });
});

describe('trackOccupancy', () => {
  const rows = trackOccupancy(track, placements, window);

  it('counts only the cars on that track', () => {
    expect(rows.find((row) => row.date === '2024-03-04').cars).toBe(1);
  });

  it('marks the days the track was full', () => {
    expect(fullDays(rows)).toEqual(['2024-03-05', '2024-03-06']);
    expect(wasFullOn(rows, '2024-03-05')).toBe(true);
    expect(wasFullOn(rows, '2024-03-04')).toBe(false);
    expect(wasFullOn(rows, '2024-04-01')).toBe(false);
  });

  it('reports the spare room', () => {
    expect(rows.find((row) => row.date === '2024-03-04').spare).toBe(1);
    expect(rows.find((row) => row.date === '2024-03-05').spare).toBe(0);
  });

  it('never reports negative spare room', () => {
    const crowded = trackOccupancy({ ...track, capacityCars: 1 }, placements, window);
    expect(crowded.every((row) => row.spare >= 0)).toBe(true);
  });

  it('is in date order', () => {
    expect(rows.map((row) => row.date)).toEqual([...rows.map((row) => row.date)].sort());
  });

  it('needs a track', () => {
    expect(() => trackOccupancy(undefined, placements, window)).toThrow(ValidationError);
  });
});

describe('the figures', () => {
  const rows = trackOccupancy(track, placements, window);

  it('reports the peak and the average', () => {
    expect(peakOccupancy(rows)).toBe(2);
    expect(averageOccupancy(rows)).toBe(1.2);
  });

  it('reports utilisation against the capacity', () => {
    expect(utilisation(rows)).toBe(0.6);
  });

  it('is zero for nothing at all', () => {
    expect(peakOccupancy([])).toBe(0);
    expect(averageOccupancy([])).toBe(0);
    expect(utilisation([])).toBe(0);
  });

  it('is zero when the track has no capacity', () => {
    const rowsWithNoCapacity = [{ date: '2024-03-04', cars: 0, capacity: 0, full: true, spare: 0 }];
    expect(utilisation(rowsWithNoCapacity)).toBe(0);
  });
});

describe('finding room', () => {
  const rows = trackOccupancy(track, placements, window);

  it('names the next day with a spare length', () => {
    expect(firstSpareDay(rows, '2024-03-04')).toBe('2024-03-07');
  });

  it('has nothing when the track stays full', () => {
    const crowded = trackOccupancy({ ...track, capacityCars: 1 }, placements, {
      from: '2024-03-04',
      to: '2024-03-06',
    });
    expect(firstSpareDay(crowded, '2024-03-04')).toBeUndefined();
  });

  it('steps a day', () => {
    expect(nextDay('2024-02-28')).toBe('2024-02-29');
  });
});

describe('occupancyFor', () => {
  it('looks the track up in the book', () => {
    expect(occupancyFor(book, 'IT-9', placements, window)).toHaveLength(5);
  });

  it('throws for a track the book does not hold', () => {
    expect(() => occupancyFor(book, 'IT-99', placements, window)).toThrow(NotFoundError);
  });
});
