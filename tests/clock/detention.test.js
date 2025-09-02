import { describe, expect, it } from 'vitest';
import {
  actualDetentions,
  isStillStanding,
  buildDetentions,
  constructiveDetentions,
  countRespots,
  detentionMinutes,
  firstStart,
  isOpen,
  lastRelease,
} from '../../src/clock/detention.js';
import { trackEvent } from '../../src/events/event.js';
import { TRACK_ROLE, trackBook } from '../../src/site/track.js';
import { tariff } from '../../src/tariff/tariff.js';
import { parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const tracks = trackBook([
  { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
  { id: 'HT-1', splc: '412300', name: 'North hold', role: TRACK_ROLE.HOLD, capacityCars: 20 },
]);

const page = tariff({ id: 'DEM-4000', carrier: 'BNSF', ladder: [{ fromDay: 1, rate: '150.00' }] });
const noNotice = tariff({
  id: 'DEM-4001',
  carrier: 'BNSF',
  notificationRequired: false,
  ladder: [{ fromDay: 1, rate: '150.00' }],
});

const build = (rows) => rows.map((row) => trackEvent({ carId: 'BNSF 400123', ...row }));
const at = (text) => parseInstant(text, -360);

describe('one plain detention', () => {
  const events = build([
    { code: 'NOT', at: '2024-03-07T07:00' },
    { code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' },
    { code: 'REL', at: '2024-03-09T10:00' },
  ]);

  it('opens at the placement and closes at the release', () => {
    const [detention] = buildDetentions(events, { page, trackBook: tracks });
    expect(detention.startsAt).toBe(at('2024-03-07T08:00'));
    expect(detention.releasedAt).toBe(at('2024-03-09T10:00'));
    expect(isOpen(detention)).toBe(false);
  });

  it('measures the span', () => {
    const [detention] = buildDetentions(events, { page, trackBook: tracks });
    expect(detentionMinutes(detention)).toBe(50 * 60);
  });

  it('carries the track it stood on', () => {
    const [detention] = buildDetentions(events, { page, trackBook: tracks });
    expect(detention.trackId).toBe('IT-9');
    expect(detention.kind).toBe('actual');
  });
});

describe('notice arriving after the placement', () => {
  it('moves the start without moving the placement', () => {
    const events = build([
      { code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' },
      { code: 'NOT', at: '2024-03-07T15:00' },
      { code: 'REL', at: '2024-03-09T10:00' },
    ]);
    const [detention] = buildDetentions(events, { page, trackBook: tracks });
    expect(detention.placedAt).toBe(at('2024-03-07T08:00'));
    expect(detention.startsAt).toBe(at('2024-03-07T15:00'));
  });

  it('leaves the span undefined when notice never came', () => {
    const events = build([
      { code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' },
      { code: 'REL', at: '2024-03-09T10:00' },
    ]);
    const [detention] = buildDetentions(events, { page, trackBook: tracks });
    expect(detention.startsAt).toBeUndefined();
    expect(detention.span).toBeUndefined();
    expect(detentionMinutes(detention)).toBe(0);
  });

  it('does not wait for notice on a page that does not require it', () => {
    const events = build([
      { code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' },
      { code: 'REL', at: '2024-03-09T10:00' },
    ]);
    const [detention] = buildDetentions(events, { page: noNotice, trackBook: tracks });
    expect(detention.startsAt).toBe(at('2024-03-07T08:00'));
  });
});

describe('respots', () => {
  const events = build([
    { code: 'NOT', at: '2024-03-07T07:00' },
    { code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' },
    { code: 'REL', at: '2024-03-08T08:00' },
    { code: 'RSP', at: '2024-03-08T14:00', trackId: 'IT-9' },
    { code: 'REL', at: '2024-03-10T08:00' },
  ]);

  it('opens a second detention', () => {
    const detentions = buildDetentions(events, { page: noNotice, trackBook: tracks });
    expect(detentions).toHaveLength(2);
    expect(countRespots(detentions)).toBe(1);
  });

  it('runs each one on its own clock', () => {
    const detentions = buildDetentions(events, { page: noNotice, trackBook: tracks });
    expect(detentionMinutes(detentions[0])).toBe(24 * 60);
    expect(detentionMinutes(detentions[1])).toBe(42 * 60);
  });

  it('reports the outer bounds', () => {
    const detentions = buildDetentions(events, { page: noNotice, trackBook: tracks });
    expect(firstStart(detentions)).toBe(at('2024-03-07T08:00'));
    expect(lastRelease(detentions)).toBe(at('2024-03-10T08:00'));
  });
});

describe('a placement that never closed', () => {
  const events = build([
    { code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' },
    { code: 'AP', at: '2024-03-20T08:00', trackId: 'IT-9' },
  ]);

  it('closes the first one when a second placement lands', () => {
    const detentions = buildDetentions(events, { page: noNotice, trackBook: tracks });
    expect(detentions).toHaveLength(2);
    expect(detentions[0].releasedAt).toBeUndefined();
  });

  it('bills an open detention to the cut off it is given', () => {
    const cut = at('2024-03-31T23:59');
    const detentions = buildDetentions(events, { page: noNotice, trackBook: tracks, until: cut });
    expect(isOpen(detentions[1])).toBe(false);
    expect(detentions[1].releasedAt).toBe(cut);
  });

  it('leaves it open when no cut off is given', () => {
    const detentions = buildDetentions(events, { page: noNotice, trackBook: tracks });
    expect(isOpen(detentions[1])).toBe(true);
  });
});

describe('constructive and actual', () => {
  it('splits them by the track the car stood on', () => {
    const events = build([
      { code: 'CP', at: '2024-03-07T08:00', trackId: 'HT-1' },
      { code: 'REL', at: '2024-03-08T08:00' },
      { code: 'AP', at: '2024-03-09T08:00', trackId: 'IT-9' },
      { code: 'REL', at: '2024-03-10T08:00' },
    ]);
    const detentions = buildDetentions(events, { page: noNotice, trackBook: tracks });
    expect(constructiveDetentions(detentions)).toHaveLength(1);
    expect(actualDetentions(detentions)).toHaveLength(1);
  });
});

describe('edges', () => {
  it('has nothing for a car that was never placed', () => {
    expect(buildDetentions(build([{ code: 'ARR', at: '2024-03-06T22:00' }]), { page })).toEqual([]);
  });

  it('ignores a release with no placement', () => {
    expect(buildDetentions(build([{ code: 'REL', at: '2024-03-09T10:00' }]), { page })).toEqual([]);
  });

  it('has no span when the release lands before the start', () => {
    const events = build([
      { code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' },
      { code: 'NOT', at: '2024-03-20T08:00' },
    ]);
    const [detention] = buildDetentions(events, {
      page,
      trackBook: tracks,
      until: at('2024-03-10T08:00'),
    });
    expect(detention.span).toBeUndefined();
  });

  it('needs a page', () => {
    expect(() => buildDetentions([], {})).toThrow(ValidationError);
  });

  it('reports nothing for the outer bounds of nothing', () => {
    expect(firstStart([])).toBeUndefined();
    expect(lastRelease([])).toBeUndefined();
    expect(countRespots([])).toBe(0);
  });
});

describe('closed by a later placement rather than a release', () => {
  const events = build([
    { code: 'CP', at: '2024-03-04T06:00', trackId: 'HT-1' },
    { code: 'AP', at: '2024-03-06T08:00', trackId: 'IT-9' },
    { code: 'REL', at: '2024-03-09T08:00' },
  ]);

  it('marks the first detention superseded', () => {
    const [first, second] = buildDetentions(events, { page: noNotice, trackBook: tracks });
    expect(first.superseded).toBe(true);
    expect(second.superseded).toBe(false);
  });

  it('still reads as open, because nothing released it', () => {
    const [first] = buildDetentions(events, { page: noNotice, trackBook: tracks });
    expect(isOpen(first)).toBe(true);
  });

  it('is not a car still standing at the cut off', () => {
    const [first, second] = buildDetentions(events, { page: noNotice, trackBook: tracks });
    expect(isStillStanding(first)).toBe(false);
    expect(isStillStanding(second)).toBe(false);
  });

  it('does count a car nothing ever closed as still standing', () => {
    const [only] = buildDetentions(
      build([{ code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' }]),
      { page: noNotice, trackBook: tracks }
    );
    expect(isStillStanding(only)).toBe(true);
  });

  it('does not count a released car as still standing', () => {
    const [only] = buildDetentions(
      build([
        { code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
        { code: 'REL', at: '2024-03-08T00:00' },
      ]),
      { page: noNotice, trackBook: tracks }
    );
    expect(isStillStanding(only)).toBe(false);
  });
});
