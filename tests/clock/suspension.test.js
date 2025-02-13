import { describe, expect, it } from 'vitest';
import {
  hasUnclosedSuspension,
  suspendedMinutes,
  suspensionsFrom,
} from '../../src/clock/suspension.js';
import { trackEvent } from '../../src/events/event.js';
import { EXCLUSION } from '../../src/exclusions/exclusion.js';
import { parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const at = (text) => parseInstant(text, -360);
const build = (rows) => rows.map((row) => trackEvent({ carId: 'BNSF 400123', ...row }));
const scope = { splc: '412300', consigneeId: 'DELTA' };

describe('a closed bad order', () => {
  const { exclusions, unclosed } = suspensionsFrom(
    build([
      { code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
      { code: 'BO', at: '2024-03-05T06:00' },
      { code: 'BOR', at: '2024-03-06T18:00' },
      { code: 'REL', at: '2024-03-08T00:00' },
    ]),
    scope
  );

  it('becomes one exclusion', () => {
    expect(exclusions).toHaveLength(1);
    expect(exclusions[0].kind).toBe(EXCLUSION.BAD_ORDER);
  });

  it('covers exactly the reported stretch', () => {
    expect(exclusions[0].span.start).toBe(at('2024-03-05T06:00'));
    expect(exclusions[0].span.end).toBe(at('2024-03-06T18:00'));
    expect(suspendedMinutes({ exclusions })).toBe(36 * 60);
  });

  it('names the car rather than the station', () => {
    expect(exclusions[0].carId).toBe('BNSF 400123');
    expect(exclusions[0].splc).toBeUndefined();
  });

  it('leaves nothing open', () => {
    expect(unclosed).toEqual([]);
    expect(hasUnclosedSuspension({ unclosed })).toBe(false);
  });

  it('references the event it came from', () => {
    expect(exclusions[0].reference).toMatch(/^event [0-9a-f]{8}$/);
  });
});

describe('an embargo and a hold', () => {
  it('scopes an embargo to the station', () => {
    const { exclusions } = suspensionsFrom(
      build([
        { code: 'EMB', at: '2024-03-05T00:00' },
        { code: 'EMR', at: '2024-03-06T00:00' },
      ]),
      scope
    );
    expect(exclusions[0].kind).toBe(EXCLUSION.EMBARGO);
    expect(exclusions[0].splc).toBe('412300');
    expect(exclusions[0].carId).toBeUndefined();
  });

  it('scopes a hold to the consignee', () => {
    const { exclusions } = suspensionsFrom(
      build([
        { code: 'HLD', at: '2024-03-05T00:00' },
        { code: 'HLR', at: '2024-03-06T00:00' },
      ]),
      scope
    );
    expect(exclusions[0].kind).toBe(EXCLUSION.PLANT_CLOSURE);
    expect(exclusions[0].consigneeId).toBe('DELTA');
    expect(exclusions[0].splc).toBe('412300');
  });
});

describe('a suspension that never closed', () => {
  const events = build([
    { code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
    { code: 'BO', at: '2024-03-05T06:00' },
  ]);

  it('runs to the cut off when there is one', () => {
    const { exclusions, unclosed } = suspensionsFrom(events, {
      ...scope,
      until: at('2024-04-01T00:00'),
    });
    expect(exclusions).toHaveLength(1);
    expect(exclusions[0].span.end).toBe(at('2024-04-01T00:00'));
    expect(unclosed).toEqual([]);
  });

  it('is reported rather than invented when there is no cut off', () => {
    const { exclusions, unclosed } = suspensionsFrom(events, scope);
    expect(exclusions).toEqual([]);
    expect(unclosed[0].code).toBe('BO');
    expect(hasUnclosedSuspension({ unclosed })).toBe(true);
  });

  it('is reported when the cut off is before the suspension started', () => {
    const { unclosed } = suspensionsFrom(events, { ...scope, until: at('2024-03-01T00:00') });
    expect(unclosed).toHaveLength(1);
  });
});

describe('mismatched pairs', () => {
  it('ignores a resume that does not match the suspension', () => {
    const { exclusions, unclosed } = suspensionsFrom(
      build([
        { code: 'BO', at: '2024-03-05T00:00' },
        { code: 'EMR', at: '2024-03-06T00:00' },
      ]),
      scope
    );
    expect(exclusions).toEqual([]);
    expect(unclosed).toHaveLength(1);
  });

  it('closes the first when a second suspension opens', () => {
    const { exclusions, unclosed } = suspensionsFrom(
      build([
        { code: 'BO', at: '2024-03-05T00:00' },
        { code: 'EMB', at: '2024-03-06T00:00' },
        { code: 'EMR', at: '2024-03-07T00:00' },
      ]),
      scope
    );
    expect(exclusions).toHaveLength(1);
    expect(exclusions[0].kind).toBe(EXCLUSION.EMBARGO);
    expect(unclosed[0].code).toBe('BO');
  });

  it('ignores a resume with nothing open', () => {
    const { exclusions } = suspensionsFrom(build([{ code: 'BOR', at: '2024-03-06T00:00' }]), scope);
    expect(exclusions).toEqual([]);
  });

  it('has nothing to do with an ordinary stream', () => {
    const { exclusions, unclosed } = suspensionsFrom(
      build([
        { code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
        { code: 'REL', at: '2024-03-08T00:00' },
      ]),
      scope
    );
    expect(exclusions).toEqual([]);
    expect(unclosed).toEqual([]);
  });

  it('refuses a non array', () => {
    expect(() => suspensionsFrom('nope')).toThrow(ValidationError);
  });
});
