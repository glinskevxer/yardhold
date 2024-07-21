import { describe, expect, it } from 'vitest';
import {
  bunchedOnly,
  groupsByDay,
  largestGroup,
  matchPlacements,
  placementRecord,
  unorderedOnly,
} from '../../src/bunching/grouping.js';
import { orderSchedule } from '../../src/bunching/orderSchedule.js';
import { formatCivilDate } from '../../src/time/civil.js';
import { ValidationError } from '../../src/core/errors.js';

const schedule = orderSchedule([
  { consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-04', cars: 2 },
  { consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-05', cars: 2 },
  { consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-06', cars: 2 },
]);

const placed = (carId, day) => ({ carId, placedOn: day, consigneeId: 'DELTA', splc: '412300' });

describe('placementRecord', () => {
  it('normalises the consignee and the day', () => {
    const record = placementRecord({
      carId: 'BNSF 1',
      placedOn: '2024-03-04',
      consigneeId: 'delta',
      splc: '412300',
    });
    expect(record.consigneeId).toBe('DELTA');
    expect(formatCivilDate(record.placedOn)).toBe('2024-03-04');
  });

  it('needs every field', () => {
    expect(() => placementRecord({ placedOn: '2024-03-04', consigneeId: 'D', splc: '1' })).toThrow(
      ValidationError
    );
  });
});

describe('cars that turned up when they were asked for', () => {
  it('marks nothing bunched', () => {
    const matches = matchPlacements(
      [placed('A', '2024-03-04'), placed('B', '2024-03-04')],
      schedule
    );
    expect(bunchedOnly(matches)).toEqual([]);
    expect(matches.every((match) => match.drift === 0)).toBe(true);
  });

  it('fills the day it was ordered for', () => {
    const matches = matchPlacements([placed('A', '2024-03-05')], schedule);
    expect(matches[0].filledOrderDay).toBe('2024-03-04');
  });
});

describe('a week of cars arriving on one day', () => {
  const matches = matchPlacements(
    ['A', 'B', 'C', 'D', 'E', 'F'].map((car) => placed(car, '2024-03-06')),
    schedule
  );

  it('marks the ones filling older orders as bunched', () => {
    expect(bunchedOnly(matches)).toHaveLength(4);
  });

  it('measures how late each one was', () => {
    expect(matches.map((match) => match.drift)).toEqual([2, 2, 1, 1, 0, 0]);
  });

  it('gives every car in the group the same group size', () => {
    expect(matches.every((match) => match.groupSize === 6)).toBe(true);
    expect(largestGroup(matches)).toBe(6);
  });

  it('fills the oldest order first', () => {
    expect(matches[0].filledOrderDay).toBe('2024-03-04');
    expect(matches[4].filledOrderDay).toBe('2024-03-06');
  });
});

describe('cars nobody ordered', () => {
  it('leaves them unfilled and unbunched', () => {
    const matches = matchPlacements(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((car) => placed(car, '2024-03-06')),
      schedule
    );
    const loose = unorderedOnly(matches);
    expect(loose).toHaveLength(1);
    expect(loose[0].bunched).toBe(false);
  });

  it('gives no relief to a plant that ordered nothing', () => {
    const matches = matchPlacements([placed('A', '2024-03-06')], orderSchedule([]));
    expect(matches[0].filledOrderDay).toBeUndefined();
    expect(matches[0].bunched).toBe(false);
  });
});

describe('scoping', () => {
  it('keeps two consignees apart', () => {
    const mixed = [
      placed('A', '2024-03-06'),
      { carId: 'B', placedOn: '2024-03-06', consigneeId: 'ACME', splc: '412300' },
    ];
    expect(matchPlacements(mixed, schedule, { consigneeId: 'delta' })).toHaveLength(1);
  });

  it('takes every consignee when none is named', () => {
    const mixed = [
      placed('A', '2024-03-06'),
      { carId: 'B', placedOn: '2024-03-06', consigneeId: 'ACME', splc: '412300' },
    ];
    expect(matchPlacements(mixed, schedule)).toHaveLength(2);
  });

  it('refuses a non array', () => {
    expect(() => matchPlacements('nope', schedule)).toThrow(ValidationError);
  });
});

describe('groupsByDay', () => {
  it('splits the matches by the day they landed', () => {
    const matches = matchPlacements(
      [placed('A', '2024-03-04'), placed('B', '2024-03-06'), placed('C', '2024-03-06')],
      schedule
    );
    const grouped = groupsByDay(matches);
    expect([...grouped.keys()]).toEqual(['2024-03-04', '2024-03-06']);
    expect(grouped.get('2024-03-06')).toHaveLength(2);
  });

  it('handles nothing at all', () => {
    expect(groupsByDay([]).size).toBe(0);
    expect(largestGroup([])).toBe(0);
  });
});
