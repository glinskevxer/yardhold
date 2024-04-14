import { describe, expect, it } from 'vitest';
import {
  SUSPENSION_PAIRS,
  compareEventCodes,
  describeEventCode,
  eventCode,
  eventKind,
  isKnownEventCode,
  knownEventCodes,
  orderPosition,
  resumeCodeFor,
  resumesClock,
  startsClock,
  stopsClock,
  suspendsClock,
} from '../../src/events/eventTypes.js';
import { NotFoundError, ValidationError } from '../../src/core/errors.js';

describe('eventCode', () => {
  it('uppercases and trims', () => {
    expect(eventCode(' ap ')).toBe('AP');
  });

  it('refuses a non string', () => {
    expect(() => eventCode(4)).toThrow(ValidationError);
  });
});

describe('eventKind', () => {
  it('reads a known code', () => {
    const kind = eventKind('AP');
    expect(kind.code).toBe('AP');
    expect(kind.name).toBe('actual placement');
    expect(kind.starts).toBe(true);
  });

  it('fills in the flags that are not written down', () => {
    expect(eventKind('AP').suspends).toBe(false);
    expect(eventKind('AP').resumes).toBe(false);
  });

  it('throws on an unknown code', () => {
    expect(() => eventKind('ZZZ')).toThrow(NotFoundError);
    expect(isKnownEventCode('ZZZ')).toBe(false);
    expect(isKnownEventCode('ap')).toBe(true);
  });

  it('lists the catalogue in order', () => {
    const codes = knownEventCodes();
    expect(codes).toEqual([...codes].sort());
    expect(codes).toContain('CP');
    expect(codes.length).toBeGreaterThan(12);
  });
});

describe('what an event does to the clock', () => {
  it('starts on either kind of placement', () => {
    expect(startsClock('CP')).toBe(true);
    expect(startsClock('AP')).toBe(true);
    expect(startsClock('RSP')).toBe(true);
    expect(startsClock('ARR')).toBe(false);
  });

  it('stops on release, pull and departure', () => {
    expect(stopsClock('REL')).toBe(true);
    expect(stopsClock('PUL')).toBe(true);
    expect(stopsClock('DEP')).toBe(true);
    expect(stopsClock('NOT')).toBe(false);
  });

  it('suspends and resumes in pairs', () => {
    expect(suspendsClock('BO')).toBe(true);
    expect(resumesClock('BOR')).toBe(true);
    expect(suspendsClock('BOR')).toBe(false);
    expect(resumesClock('BO')).toBe(false);
  });

  it('treats a diversion as a stop rather than a suspension', () => {
    expect(stopsClock('DIV')).toBe(true);
    expect(suspendsClock('DIV')).toBe(false);
  });
});

describe('ordering inside the same minute', () => {
  it('puts a placement before a release', () => {
    expect(compareEventCodes('AP', 'REL')).toBeLessThan(0);
  });

  it('puts a release before a pull', () => {
    expect(compareEventCodes('REL', 'PUL')).toBeLessThan(0);
  });

  it('puts notification before constructive placement', () => {
    expect(orderPosition('NOT')).toBeLessThan(orderPosition('CP'));
  });

  it('is zero for the same code', () => {
    expect(compareEventCodes('AP', 'AP')).toBe(0);
  });
});

describe('suspension pairs', () => {
  it('names the resume for each suspend', () => {
    expect(resumeCodeFor('BO')).toBe('BOR');
    expect(resumeCodeFor('EMB')).toBe('EMR');
    expect(resumeCodeFor('hld')).toBe('HLR');
  });

  it('has nothing for a code that does not suspend', () => {
    expect(resumeCodeFor('AP')).toBeUndefined();
  });

  it('covers every suspending code', () => {
    const suspending = knownEventCodes().filter(suspendsClock);
    expect(suspending.sort()).toEqual(Object.keys(SUSPENSION_PAIRS).sort());
  });
});

describe('describeEventCode', () => {
  it('joins the code and the name', () => {
    expect(describeEventCode('CP')).toBe('CP constructive placement');
  });
});
