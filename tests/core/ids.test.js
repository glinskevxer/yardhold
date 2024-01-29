import { describe, expect, it } from 'vitest';
import {
  fingerprint,
  parseReference,
  referenceNumber,
  sequencer,
  slug,
  stableHash,
} from '../../src/core/ids.js';
import { ValidationError } from '../../src/core/errors.js';

describe('referenceNumber', () => {
  it('pads the sequence', () => {
    expect(referenceNumber('INV', '202403', 42)).toBe('INV-202403-00042');
  });

  it('takes a wider sequence', () => {
    expect(referenceNumber('INV', '202403', 42, { width: 7 })).toBe('INV-202403-0000042');
  });

  it('refuses a lowercase or long prefix', () => {
    expect(() => referenceNumber('inv', '202403', 1)).toThrow(ValidationError);
    expect(() => referenceNumber('INVOICE', '202403', 1)).toThrow(ValidationError);
  });

  it('refuses a period that is not a real month', () => {
    expect(() => referenceNumber('INV', '202413', 1)).toThrow(/YYYYMM/);
    expect(() => referenceNumber('INV', '2024', 1)).toThrow(/YYYYMM/);
  });

  it('refuses a zero sequence', () => {
    expect(() => referenceNumber('INV', '202403', 0)).toThrow(ValidationError);
  });
});

describe('parseReference', () => {
  it('round trips', () => {
    const reference = referenceNumber('CLM', '202502', 7);
    expect(parseReference(reference)).toEqual({ prefix: 'CLM', period: '202502', sequence: 7 });
  });

  it('refuses a malformed reference', () => {
    expect(() => parseReference('INV/202403/1')).toThrow(ValidationError);
  });
});

describe('sequencer', () => {
  it('hands out increasing numbers', () => {
    const seq = sequencer();
    expect(seq.next()).toBe(1);
    expect(seq.next()).toBe(2);
    expect(seq.peek()).toBe(3);
  });

  it('starts where it is told and resets', () => {
    const seq = sequencer(100);
    expect(seq.next()).toBe(100);
    seq.reset(5);
    expect(seq.next()).toBe(5);
  });

  it('refuses a zero start', () => {
    expect(() => sequencer(0)).toThrow(ValidationError);
  });
});

describe('stableHash', () => {
  it('is eight hex characters', () => {
    expect(stableHash('BNSF 400123')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is stable across calls', () => {
    expect(stableHash('placement')).toBe(stableHash('placement'));
  });

  it('separates near neighbours', () => {
    expect(stableHash('placement')).not.toBe(stableHash('placemenu'));
  });

  it('accepts the empty string', () => {
    expect(stableHash('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('fingerprint', () => {
  it('does not collide across field boundaries', () => {
    expect(fingerprint(['ab', 'c'])).not.toBe(fingerprint(['a', 'bc']));
  });

  it('treats undefined and null as an empty field', () => {
    expect(fingerprint(['a', undefined])).toBe(fingerprint(['a', '']));
    expect(fingerprint(['a', null])).toBe(fingerprint(['a', '']));
  });

  it('is stable for the same tuple', () => {
    expect(fingerprint(['UP', 12345, '2024-03-01'])).toBe(fingerprint(['UP', 12345, '2024-03-01']));
  });
});

describe('slug', () => {
  it('lowercases and hyphenates', () => {
    expect(slug('Union Pacific  Yard #3')).toBe('union-pacific-yard-3');
  });

  it('trims stray hyphens', () => {
    expect(slug('  --Track 9--  ')).toBe('track-9');
  });
});
