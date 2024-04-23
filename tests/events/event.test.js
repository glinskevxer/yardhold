import { describe, expect, it } from 'vitest';
import {
  EVENT_SOURCE,
  cancel,
  compareEvents,
  eventId,
  formatEvent,
  isCancelled,
  isCarrierReported,
  reportingLagMinutes,
  trackEvent,
} from '../../src/events/event.js';
import { parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const base = { carId: 'bnsf400123', code: 'ap', at: '2024-03-07T08:00', trackId: 'IT-9' };

describe('building an event', () => {
  it('normalises the car id, the code and the spot', () => {
    const record = trackEvent({ ...base, spot: ' a ' });
    expect(record.carId).toBe('BNSF 400123');
    expect(record.code).toBe('AP');
    expect(record.spot).toBe('A');
  });

  it('reads the stamp at the station offset', () => {
    const record = trackEvent(base);
    expect(record.at).toBe(parseInstant('2024-03-07T08:00-06:00'));
  });

  it('takes an instant directly', () => {
    const moment = parseInstant('2024-03-07T08:00Z');
    expect(trackEvent({ ...base, at: moment }).at).toBe(moment);
  });

  it('is frozen and carries its own id', () => {
    const record = trackEvent(base);
    expect(Object.isFrozen(record)).toBe(true);
    expect(record.id).toMatch(/^[0-9a-f]{8}$/);
    expect(record.id).toBe(eventId(record));
  });

  it('refuses an unknown code', () => {
    expect(() => trackEvent({ ...base, code: 'ZZZ' })).toThrow();
  });

  it('refuses a missing car or stamp', () => {
    expect(() => trackEvent({ ...base, carId: undefined })).toThrow(ValidationError);
    expect(() => trackEvent({ ...base, at: undefined })).toThrow(ValidationError);
  });
});

describe('source and reason', () => {
  it('defaults to a carrier report', () => {
    expect(trackEvent(base).source).toBe(EVENT_SOURCE.CARRIER);
    expect(isCarrierReported(trackEvent(base))).toBe(true);
  });

  it('makes an office entry explain itself', () => {
    expect(() => trackEvent({ ...base, source: EVENT_SOURCE.OFFICE })).toThrow(/needs a reason/);
    const record = trackEvent({
      ...base,
      source: EVENT_SOURCE.OFFICE,
      reason: 'phoned in by the yardmaster',
    });
    expect(record.reason).toBe('phoned in by the yardmaster');
    expect(isCarrierReported(record)).toBe(false);
  });

  it('lets a derived event stand with no reason', () => {
    expect(trackEvent({ ...base, source: EVENT_SOURCE.DERIVED }).reason).toBeUndefined();
  });

  it('refuses a source it does not know', () => {
    expect(() => trackEvent({ ...base, source: 'guess' })).toThrow(ValidationError);
  });
});

describe('reporting lag', () => {
  it('is zero when no report time is given', () => {
    expect(reportingLagMinutes(trackEvent(base))).toBe(0);
  });

  it('measures a late report', () => {
    const record = trackEvent({ ...base, reportedAt: '2024-03-07T14:30' });
    expect(reportingLagMinutes(record)).toBe(390);
  });

  it('refuses a report before the event', () => {
    expect(() => trackEvent({ ...base, reportedAt: '2024-03-07T07:00' })).toThrow(
      /reported before it happened/
    );
  });
});

describe('cancelling', () => {
  it('flags the record and keeps the reason', () => {
    const record = cancel(trackEvent(base), 'duplicate of the carrier feed');
    expect(isCancelled(record)).toBe(true);
    expect(record.reason).toBe('duplicate of the carrier feed');
    expect(isCancelled(trackEvent(base))).toBe(false);
  });

  it('needs a reason', () => {
    expect(() => cancel(trackEvent(base))).toThrow(ValidationError);
  });
});

describe('ordering', () => {
  it('sorts by stamp first', () => {
    const early = trackEvent({ ...base, at: '2024-03-07T08:00' });
    const late = trackEvent({ ...base, at: '2024-03-07T09:00' });
    expect(compareEvents(early, late)).toBeLessThan(0);
  });

  it('breaks a tie on what the code does', () => {
    const release = trackEvent({ ...base, code: 'REL' });
    const pull = trackEvent({ ...base, code: 'PUL' });
    expect(compareEvents(release, pull)).toBeLessThan(0);
  });

  it('is deterministic for two events of the same code and minute', () => {
    const one = trackEvent({ ...base, trackId: 'IT-9' });
    const two = trackEvent({ ...base, trackId: 'IT-10' });
    expect(compareEvents(one, two)).toBe(-compareEvents(two, one));
    expect(compareEvents(one, two)).not.toBe(0);
  });
});

describe('formatEvent', () => {
  it('reads back at the station offset', () => {
    expect(formatEvent(trackEvent(base))).toBe('BNSF 400123 AP 2024-03-07T08:00-06:00 IT-9');
  });

  it('leaves the track out when there is none', () => {
    expect(formatEvent(trackEvent({ ...base, trackId: undefined }))).toBe(
      'BNSF 400123 AP 2024-03-07T08:00-06:00'
    );
  });
});
