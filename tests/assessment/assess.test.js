import { describe, expect, it } from 'vitest';
import {
  assessCar,
  assessmentTotal,
  chargedDates,
  freeDaysUsed,
  hasCharge,
  reliefApplied,
} from '../../src/assessment/assess.js';
import { trackEvent } from '../../src/events/event.js';
import { TRACK_ROLE, trackBook } from '../../src/site/track.js';
import { tariff } from '../../src/tariff/tariff.js';
import { SERVICE } from '../../src/tariff/freeTimeTable.js';
import { LADDER_RESET, rateLadder } from '../../src/tariff/rateLadder.js';
import { serviceCalendar } from '../../src/time/serviceCalendar.js';
import { EVIDENCE, EXCLUSION, exclusion } from '../../src/exclusions/exclusion.js';
import { parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const tracks = trackBook([
  { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
  { id: 'HT-1', splc: '412300', name: 'North hold', role: TRACK_ROLE.HOLD, capacityCars: 20 },
]);

const calendar = serviceCalendar({ id: 'MEM', years: [2024] });
const at = (text) => parseInstant(text, -360);

const ladder = [
  { fromDay: 1, rate: '150.00', toDay: 2 },
  { fromDay: 3, rate: '225.00' },
];

const page = tariff({
  id: 'DEM-4000',
  carrier: 'BNSF',
  notificationRequired: false,
  ladder,
  freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
});

const build = (rows) => rows.map((row) => trackEvent({ carId: 'BNSF 400123', ...row }));
const query = { service: SERVICE.UNLOADING };

describe('one detention', () => {
  const events = build([
    { code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
    { code: 'REL', at: '2024-03-08T00:00' },
  ]);

  it('charges the days after the free one', () => {
    const assessment = assessCar({
      carId: 'BNSF 400123',
      events,
      page,
      calendar,
      trackBook: tracks,
      query,
    });
    expect(assessment.chargeableDays).toBe(3);
    expect(chargedDates(assessment)).toEqual(['2024-03-05', '2024-03-06', '2024-03-07']);
  });

  it('prices them up the ladder', () => {
    const assessment = assessCar({
      carId: 'BNSF 400123',
      events,
      page,
      calendar,
      trackBook: tracks,
      query,
    });
    expect(assessment.lines.map((line) => line.rate)).toEqual([15000, 15000, 22500]);
    expect(assessmentTotal(assessment)).toBe(52500);
    expect(hasCharge(assessment)).toBe(true);
  });

  it('records the free day it spent', () => {
    const assessment = assessCar({
      carId: 'BNSF 400123',
      events,
      page,
      calendar,
      trackBook: tracks,
      query,
    });
    expect(freeDaysUsed(assessment)).toBe(1);
  });

  it('carries the placement onto every line', () => {
    const assessment = assessCar({
      carId: 'BNSF 400123',
      events,
      page,
      calendar,
      trackBook: tracks,
      query,
    });
    expect(assessment.lines.every((line) => line.placement === 'actual')).toBe(true);
    expect(assessment.lines.every((line) => line.trackId === 'IT-9')).toBe(true);
  });
});

describe('a car that never went over its free time', () => {
  it('charges nothing and skips the minimum', () => {
    const events = build([
      { code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
      { code: 'REL', at: '2024-03-05T00:00' },
    ]);
    const withMinimum = tariff({
      id: 'DEM-4000',
      carrier: 'BNSF',
      notificationRequired: false,
      minimumCharge: '100.00',
      ladder,
      freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
    });
    const assessment = assessCar({
      carId: 'BNSF 400123',
      events,
      page: withMinimum,
      calendar,
      trackBook: tracks,
      query,
    });
    expect(assessment.gross).toBe(0);
    expect(assessment.total).toBe(0);
    expect(hasCharge(assessment)).toBe(false);
  });

  it('lifts a small charge to the minimum', () => {
    const events = build([
      { code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
      { code: 'REL', at: '2024-03-06T00:00' },
    ]);
    const withMinimum = tariff({
      id: 'DEM-4000',
      carrier: 'BNSF',
      notificationRequired: false,
      minimumCharge: '400.00',
      ladder,
      freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
    });
    const assessment = assessCar({
      carId: 'BNSF 400123',
      events,
      page: withMinimum,
      calendar,
      trackBook: tracks,
      query,
    });
    expect(assessment.gross).toBe(15000);
    expect(assessment.total).toBe(40000);
  });
});

describe('respots and the ladder reset rule', () => {
  const events = build([
    { code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
    { code: 'REL', at: '2024-03-07T00:00' },
    { code: 'RSP', at: '2024-03-07T12:00', trackId: 'IT-9' },
    { code: 'REL', at: '2024-03-11T00:00' },
  ]);

  it('starts each detention at the first rung when the page resets', () => {
    const assessment = assessCar({
      carId: 'BNSF 400123',
      events,
      page,
      calendar,
      trackBook: tracks,
      query,
    });
    expect(assessment.lines.map((line) => line.dayIndex)).toEqual([1, 2, 1, 2]);
  });

  it('keeps climbing when the page runs to the month', () => {
    const monthly = tariff({
      id: 'DEM-4100',
      carrier: 'BNSF',
      notificationRequired: false,
      ladder: rateLadder(ladder, { reset: LADDER_RESET.MONTH }),
      freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
    });
    const assessment = assessCar({
      carId: 'BNSF 400123',
      events,
      page: monthly,
      calendar,
      trackBook: tracks,
      query,
    });
    expect(assessment.lines.map((line) => line.dayIndex)).toEqual([1, 2, 3, 4]);
  });

  it('bills the same car more under the month ladder', () => {
    const monthly = tariff({
      id: 'DEM-4100',
      carrier: 'BNSF',
      notificationRequired: false,
      ladder: rateLadder(ladder, { reset: LADDER_RESET.MONTH }),
      freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
    });
    const reset = assessCar({
      carId: 'BNSF 400123',
      events,
      page,
      calendar,
      trackBook: tracks,
      query,
    });
    const running = assessCar({
      carId: 'BNSF 400123',
      events,
      page: monthly,
      calendar,
      trackBook: tracks,
      query,
    });
    expect(running.total).toBeGreaterThan(reset.total);
  });

  it('hands the next index back only on a month ladder', () => {
    const monthly = tariff({
      id: 'DEM-4100',
      carrier: 'BNSF',
      notificationRequired: false,
      ladder: rateLadder(ladder, { reset: LADDER_RESET.MONTH }),
      freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
    });
    expect(
      assessCar({ carId: 'BNSF 400123', events, page, calendar, trackBook: tracks, query })
        .nextIndex
    ).toBe(1);
    expect(
      assessCar({ carId: 'BNSF 400123', events, page: monthly, calendar, trackBook: tracks, query })
        .nextIndex
    ).toBe(5);
  });
});

describe('relief and open detentions', () => {
  it('credits relief that reaches the placement', () => {
    const storm = exclusion({
      kind: EXCLUSION.WEATHER,
      from: '2024-03-05T00:00',
      to: '2024-03-06T00:00',
      splc: '412300',
      evidence: EVIDENCE.CARRIER_BULLETIN,
    });
    const events = build([
      { code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
      { code: 'REL', at: '2024-03-08T00:00' },
    ]);
    const assessment = assessCar({
      carId: 'BNSF 400123',
      events,
      page,
      calendar,
      trackBook: tracks,
      exclusions: [storm],
      query,
    });
    expect(assessment.chargeableDays).toBe(2);
    expect(reliefApplied(assessment)).toHaveLength(1);
  });

  it('bills an open car to the cut off', () => {
    const events = build([{ code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' }]);
    const assessment = assessCar({
      carId: 'BNSF 400123',
      events,
      page,
      calendar,
      trackBook: tracks,
      query,
      until: at('2024-03-08T00:00'),
    });
    expect(assessment.chargeableDays).toBe(3);
  });

  it('charges nothing for a car that never stood', () => {
    const assessment = assessCar({
      carId: 'BNSF 400123',
      events: build([{ code: 'ARR', at: '2024-03-04T00:00' }]),
      page,
      calendar,
      trackBook: tracks,
      query,
    });
    expect(assessment.total).toBe(0);
    expect(assessment.lines).toEqual([]);
  });

  it('needs a car and a page', () => {
    expect(() => assessCar({ events: [], page })).toThrow(ValidationError);
    expect(() => assessCar({ carId: 'BNSF 1', events: [] })).toThrow(ValidationError);
  });
});
