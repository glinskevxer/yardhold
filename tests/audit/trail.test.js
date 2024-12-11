import { describe, expect, it } from 'vitest';
import {
  ACTION,
  auditEntry,
  auditTrail,
  describeEntry,
  inputsChanged,
  trailLines,
} from '../../src/audit/trail.js';
import { ValidationError } from '../../src/core/errors.js';

const base = {
  action: ACTION.ASSESSED,
  at: '2024-04-05T09:00',
  actor: 'clerk',
  subject: 'BNSF 400123',
  inputs: ['DEM-4000', '202403', 'feed-a'],
};

describe('auditEntry', () => {
  it('fingerprints its inputs', () => {
    expect(auditEntry(base).inputFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it('carries its own id', () => {
    expect(auditEntry(base).id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is frozen down to the inputs', () => {
    const entry = auditEntry(base);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.inputs)).toBe(true);
  });

  it('needs an actor and a subject', () => {
    expect(() => auditEntry({ ...base, actor: undefined })).toThrow(ValidationError);
    expect(() => auditEntry({ ...base, subject: undefined })).toThrow(ValidationError);
  });

  it('refuses an action it does not know', () => {
    expect(() => auditEntry({ ...base, action: 'fiddled' })).toThrow(ValidationError);
  });

  it('refuses inputs that are not a list', () => {
    expect(() => auditEntry({ ...base, inputs: 'DEM-4000' })).toThrow(/have to be a list/);
  });

  it('gives the same fingerprint for the same inputs', () => {
    expect(auditEntry(base).inputFingerprint).toBe(
      auditEntry({ ...base, actor: 'other' }).inputFingerprint
    );
  });
});

describe('inputsChanged', () => {
  it('is false when nothing moved', () => {
    expect(inputsChanged(auditEntry(base), auditEntry({ ...base, at: '2024-05-01T09:00' }))).toBe(
      false
    );
  });

  it('is true when a page changed', () => {
    const after = auditEntry({ ...base, inputs: ['DEM-4100', '202403', 'feed-a'] });
    expect(inputsChanged(auditEntry(base), after)).toBe(true);
  });

  it('is true when the feed changed', () => {
    const after = auditEntry({ ...base, inputs: ['DEM-4000', '202403', 'feed-b'] });
    expect(inputsChanged(auditEntry(base), after)).toBe(true);
  });
});

describe('auditTrail', () => {
  const trail = auditTrail([
    base,
    { ...base, action: ACTION.INVOICED, at: '2024-04-06T09:00', subject: 'INV-202403-00001' },
    { ...base, at: '2024-04-04T09:00' },
  ]);

  it('counts what it holds', () => {
    expect(trail.size).toBe(3);
  });

  it('reads back in time order', () => {
    expect(trail.all().map((entry) => entry.at)).toEqual(
      [...trail.all().map((entry) => entry.at)].sort((a, b) => a - b)
    );
  });

  it('slices by subject and by action', () => {
    expect(trail.forSubject('BNSF 400123')).toHaveLength(2);
    expect(trail.ofAction(ACTION.INVOICED)).toHaveLength(1);
    expect(trail.ofAction(ACTION.PAYMENT_APPLIED)).toEqual([]);
  });

  it('refuses an action it does not know when slicing', () => {
    expect(() => trail.ofAction('fiddled')).toThrow(ValidationError);
  });

  it('finds the last entry for a subject', () => {
    expect(trail.lastFor('BNSF 400123').at).toBeGreaterThan(trail.forSubject('BNSF 400123')[0].at);
    expect(trail.lastFor('BNSF 400123', ACTION.INVOICED)).toBeUndefined();
  });

  it('takes another entry after construction', () => {
    const fresh = auditTrail();
    fresh.record(base);
    expect(fresh.size).toBe(1);
  });
});

describe('reading the trail', () => {
  it('describes an entry on one line', () => {
    expect(describeEntry(auditEntry(base))).toMatch(
      /^2024-04-05T09:00-06:00 clerk assessed BNSF 400123 [0-9a-f]{8}$/
    );
  });

  it('lists the whole trail', () => {
    expect(trailLines(auditTrail([base]))).toHaveLength(1);
  });
});
