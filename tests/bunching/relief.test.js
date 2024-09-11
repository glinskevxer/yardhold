import { describe, expect, it } from 'vitest';
import {
  bunchingRelief,
  extraFreeDaysFor,
  relievedCars,
  totalExtraFreeDays,
} from '../../src/bunching/relief.js';
import { matchPlacements } from '../../src/bunching/grouping.js';
import { orderSchedule } from '../../src/bunching/orderSchedule.js';
import { DEFAULT_BUNCHING_CAP_DAYS, tariff } from '../../src/tariff/tariff.js';
import { ValidationError } from '../../src/core/errors.js';

const schedule = orderSchedule([
  { consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-04', cars: 2 },
  { consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-05', cars: 2 },
  { consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-06', cars: 2 },
]);

const ladder = [{ fromDay: 1, rate: '150.00' }];
const relieving = tariff({ id: 'DEM-4000', carrier: 'BNSF', bunchingRelief: true, ladder });
const plain = tariff({ id: 'DEM-4001', carrier: 'BNSF', ladder });

const placed = (carId, day) => ({ carId, placedOn: day, consigneeId: 'DELTA', splc: '412300' });
const matchesFor = (rows) => matchPlacements(rows, schedule);

describe('a page that grants no relief', () => {
  it('gives nothing however bad the bunch', () => {
    const matches = matchesFor(
      ['A', 'B', 'C', 'D', 'E', 'F'].map((car) => placed(car, '2024-03-06'))
    );
    const relieved = bunchingRelief(matches, { page: plain, schedule });
    expect(totalExtraFreeDays(relieved)).toBe(0);
    expect(relieved.every((entry) => entry.why === 'page grants no relief')).toBe(true);
  });
});

describe('a group no larger than the order', () => {
  it('gives nothing to two cars that were simply late', () => {
    const matches = matchesFor([placed('A', '2024-03-06'), placed('B', '2024-03-06')]);
    const relieved = bunchingRelief(matches, { page: relieving, schedule });
    expect(totalExtraFreeDays(relieved)).toBe(0);
    expect(relieved[0].why).toBe('not oversupplied');
  });

  it('still records how late they were', () => {
    const matches = matchesFor([placed('A', '2024-03-06'), placed('B', '2024-03-06')]);
    expect(matches.every((match) => match.drift === 2)).toBe(true);
  });
});

describe('a group larger than the order', () => {
  const matches = matchesFor(
    ['A', 'B', 'C', 'D', 'E', 'F'].map((car) => placed(car, '2024-03-06'))
  );
  const relieved = bunchingRelief(matches, { page: relieving, schedule });

  it('gives each bunched car its own drift back', () => {
    expect(relieved.map((entry) => entry.extraFreeDays)).toEqual([2, 2, 1, 1, 0, 0]);
  });

  it('gives nothing to the cars that were on time', () => {
    expect(relievedCars(relieved)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('totals the relief', () => {
    expect(totalExtraFreeDays(relieved)).toBe(6);
  });

  it('answers for one car', () => {
    expect(extraFreeDaysFor(relieved, 'A')).toBe(2);
    expect(extraFreeDaysFor(relieved, 'E')).toBe(0);
    expect(extraFreeDaysFor(relieved, 'nobody')).toBe(0);
  });
});

describe('the same drift lands differently depending on the group', () => {
  it('gives nothing when only the ordered cars turned up', () => {
    const small = bunchingRelief(
      matchesFor([placed('A', '2024-03-06'), placed('B', '2024-03-06')]),
      {
        page: relieving,
        schedule,
      }
    );
    expect(extraFreeDaysFor(small, 'A')).toBe(0);
  });

  it('gives two days for the same car once four more arrive with it', () => {
    const large = bunchingRelief(
      matchesFor(['A', 'B', 'C', 'D', 'E', 'F'].map((car) => placed(car, '2024-03-06'))),
      { page: relieving, schedule }
    );
    expect(extraFreeDaysFor(large, 'A')).toBe(2);
  });
});

describe('the cap', () => {
  const longSchedule = orderSchedule([
    { consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-01', cars: 1 },
    { consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-20', cars: 1 },
  ]);

  it('holds the relief to five days by default', () => {
    const matches = matchPlacements(
      [placed('A', '2024-03-20'), placed('B', '2024-03-20')],
      longSchedule
    );
    const relieved = bunchingRelief(matches, { page: relieving, schedule: longSchedule });
    expect(extraFreeDaysFor(relieved, 'A')).toBe(DEFAULT_BUNCHING_CAP_DAYS);
  });

  it('takes a cap off the page', () => {
    const tight = tariff({
      id: 'DEM-4002',
      carrier: 'BNSF',
      bunchingRelief: true,
      bunchingCapDays: 3,
      ladder,
    });
    const matches = matchPlacements(
      [placed('A', '2024-03-20'), placed('B', '2024-03-20')],
      longSchedule
    );
    const relieved = bunchingRelief(matches, { page: tight, schedule: longSchedule });
    expect(extraFreeDaysFor(relieved, 'A')).toBe(3);
  });

  it('takes a cap from the call', () => {
    const matches = matchPlacements(
      [placed('A', '2024-03-20'), placed('B', '2024-03-20')],
      longSchedule
    );
    const relieved = bunchingRelief(matches, {
      page: relieving,
      schedule: longSchedule,
      capDays: 2,
    });
    expect(extraFreeDaysFor(relieved, 'A')).toBe(2);
  });
});

describe('several days at once', () => {
  it('handles each day as its own group', () => {
    const matches = matchesFor([
      placed('A', '2024-03-04'),
      placed('B', '2024-03-06'),
      placed('C', '2024-03-06'),
      placed('D', '2024-03-06'),
    ]);
    const relieved = bunchingRelief(matches, { page: relieving, schedule });
    expect(relieved.map((entry) => entry.carId)).toEqual(['A', 'B', 'C', 'D']);
    expect(extraFreeDaysFor(relieved, 'A')).toBe(0);
    expect(extraFreeDaysFor(relieved, 'B')).toBeGreaterThan(0);
  });

  it('needs a page and a schedule', () => {
    expect(() => bunchingRelief([], { schedule })).toThrow(ValidationError);
    expect(() => bunchingRelief([], { page: relieving })).toThrow(ValidationError);
  });

  it('handles nothing at all', () => {
    expect(bunchingRelief([], { page: relieving, schedule })).toEqual([]);
  });
});
