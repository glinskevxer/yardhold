import { describe, expect, it } from 'vitest';
import {
  PLACEMENT,
  classifyPlacement,
  describePlacement,
  firstNotification,
  firstPlacement,
  isActual,
  isConstructive,
  noticeDelayMinutes,
  resolvePlacement,
} from '../../src/clock/placement.js';
import { trackEvent } from '../../src/events/event.js';
import { TRACK_ROLE, trackBook } from '../../src/site/track.js';
import { tariff } from '../../src/tariff/tariff.js';
import { SERVICE } from '../../src/tariff/freeTimeTable.js';
import { parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const tracks = trackBook([
  { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
  { id: 'HT-1', splc: '412300', name: 'North hold', role: TRACK_ROLE.HOLD, capacityCars: 20 },
]);

const page = tariff({
  id: 'DEM-4000',
  carrier: 'BNSF',
  ladder: [{ fromDay: 1, rate: '150.00' }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
});

const build = (rows) => rows.map((row) => trackEvent({ carId: 'BNSF 400123', ...row }));
const at = (text) => parseInstant(text, -360);

describe('classifyPlacement', () => {
  it('reads the track rather than the code', () => {
    const onHold = trackEvent({
      carId: 'BNSF 1',
      code: 'AP',
      at: '2024-03-07T08:00',
      trackId: 'HT-1',
    });
    expect(classifyPlacement(onHold, tracks)).toBe(PLACEMENT.CONSTRUCTIVE);
    const onIndustry = trackEvent({
      carId: 'BNSF 1',
      code: 'CP',
      at: '2024-03-07T08:00',
      trackId: 'IT-9',
    });
    expect(classifyPlacement(onIndustry, tracks)).toBe(PLACEMENT.ACTUAL);
  });

  it('falls back to the code when the track is unknown', () => {
    const loose = trackEvent({ carId: 'BNSF 1', code: 'AP', at: '2024-03-07T08:00' });
    expect(classifyPlacement(loose, tracks)).toBe(PLACEMENT.ACTUAL);
    const cp = trackEvent({ carId: 'BNSF 1', code: 'CP', at: '2024-03-07T08:00' });
    expect(classifyPlacement(cp, tracks)).toBe(PLACEMENT.CONSTRUCTIVE);
  });

  it('has nothing to say about no event', () => {
    expect(classifyPlacement(undefined, tracks)).toBe(PLACEMENT.NONE);
  });
});

describe('finding the events', () => {
  const events = build([
    { code: 'ARR', at: '2024-03-06T22:00' },
    { code: 'NOT', at: '2024-03-07T07:00' },
    { code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' },
  ]);

  it('finds the first placement and the first notice', () => {
    expect(firstPlacement(events).code).toBe('AP');
    expect(firstNotification(events).code).toBe('NOT');
  });

  it('returns nothing when there is none', () => {
    expect(firstPlacement(build([{ code: 'ARR', at: '2024-03-06T22:00' }]))).toBeUndefined();
    expect(firstNotification(build([{ code: 'ARR', at: '2024-03-06T22:00' }]))).toBeUndefined();
  });
});

describe('resolvePlacement', () => {
  it('starts at the placement when notice came first', () => {
    const events = build([
      { code: 'NOT', at: '2024-03-07T07:00' },
      { code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' },
    ]);
    const resolved = resolvePlacement(events, { page, trackBook: tracks });
    expect(resolved.startsAt).toBe(at('2024-03-07T08:00'));
    expect(isActual(resolved)).toBe(true);
  });

  it('waits for the notice when it came after the placement', () => {
    const events = build([
      { code: 'CP', at: '2024-03-07T08:00', trackId: 'HT-1' },
      { code: 'NOT', at: '2024-03-07T15:00' },
    ]);
    const resolved = resolvePlacement(events, { page, trackBook: tracks });
    expect(resolved.startsAt).toBe(at('2024-03-07T15:00'));
    expect(isConstructive(resolved)).toBe(true);
    expect(noticeDelayMinutes(resolved)).toBe(420);
  });

  it('adds the grace the page allows', () => {
    const graced = tariff({
      id: 'DEM-4000',
      carrier: 'BNSF',
      noticeGraceMinutes: 120,
      ladder: [{ fromDay: 1, rate: '150.00' }],
    });
    const events = build([
      { code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' },
      { code: 'NOT', at: '2024-03-07T15:00' },
    ]);
    expect(resolvePlacement(events, { page: graced, trackBook: tracks }).startsAt).toBe(
      at('2024-03-07T17:00')
    );
  });

  it('never starts when notice is required and never came', () => {
    const events = build([{ code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' }]);
    const resolved = resolvePlacement(events, { page, trackBook: tracks });
    expect(resolved.startsAt).toBeUndefined();
    expect(resolved.waitingOnNotice).toBe(true);
  });

  it('ignores notice entirely on a page that does not require it', () => {
    const relaxed = tariff({
      id: 'DEM-4001',
      carrier: 'BNSF',
      notificationRequired: false,
      ladder: [{ fromDay: 1, rate: '150.00' }],
    });
    const events = build([
      { code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' },
      { code: 'NOT', at: '2024-03-09T15:00' },
    ]);
    const resolved = resolvePlacement(events, { page: relaxed, trackBook: tracks });
    expect(resolved.startsAt).toBe(at('2024-03-07T08:00'));
    expect(resolved.waitingOnNotice).toBe(false);
  });

  it('reports nothing at all for a car that was never placed', () => {
    const resolved = resolvePlacement(build([{ code: 'ARR', at: '2024-03-06T22:00' }]), {
      page,
      trackBook: tracks,
    });
    expect(resolved.kind).toBe(PLACEMENT.NONE);
    expect(noticeDelayMinutes(resolved)).toBe(0);
  });

  it('needs a page', () => {
    expect(() => resolvePlacement([], {})).toThrow(ValidationError);
  });
});

describe('describePlacement', () => {
  it('says what happened', () => {
    expect(describePlacement({ kind: PLACEMENT.NONE })).toBe('never placed');
    expect(describePlacement({ kind: PLACEMENT.ACTUAL, waitingOnNotice: false })).toBe(
      'actual placement'
    );
    expect(describePlacement({ kind: PLACEMENT.CONSTRUCTIVE, waitingOnNotice: true })).toBe(
      'constructive placement, notice outstanding'
    );
  });
});
