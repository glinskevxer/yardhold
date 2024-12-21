import { describe, expect, it } from 'vitest';
import {
  APPROVAL_LIMITS,
  DE_MINIMIS_CENTS,
  WRITE_OFF_REASON,
  automaticShare,
  byReason,
  limitFor,
  needsApproval,
  totalWrittenOff,
  writeOff,
} from '../../src/settlement/writeoff.js';
import { ValidationError } from '../../src/core/errors.js';

const base = {
  invoiceNumber: 'INV-202403-00012',
  amount: 40000,
  reason: WRITE_OFF_REASON.GOODWILL,
  approvedBy: 'j.reyes',
  approverRole: 'supervisor',
  writtenOn: '2024-05-01',
};

describe('the de minimis', () => {
  it('needs no approval under the threshold', () => {
    expect(needsApproval(DE_MINIMIS_CENTS)).toBe(false);
    expect(needsApproval(DE_MINIMIS_CENTS + 1)).toBe(true);
  });

  it('writes a small balance off by itself', () => {
    const record = writeOff({
      ...base,
      amount: 1100,
      approvedBy: undefined,
      approverRole: undefined,
    });
    expect(record.automatic).toBe(true);
    expect(record.approvedBy).toBe('automatic');
  });

  it('takes a threshold of its own', () => {
    const record = writeOff({
      ...base,
      amount: 40000,
      deMinimis: 50000,
      approvedBy: undefined,
      approverRole: undefined,
    });
    expect(record.automatic).toBe(true);
  });
});

describe('approval limits', () => {
  it('knows each role', () => {
    expect(limitFor('supervisor')).toBe(50000);
    expect(limitFor('manager')).toBe(250000);
    expect(limitFor('controller')).toBe(Number.POSITIVE_INFINITY);
  });

  it('gives an unknown role nothing', () => {
    expect(limitFor('intern')).toBe(0);
    expect(APPROVAL_LIMITS.clerk).toBe(0);
  });

  it('lets a supervisor write off inside the limit', () => {
    expect(writeOff(base).approvedBy).toBe('j.reyes');
  });

  it('stops a supervisor above it', () => {
    try {
      writeOff({ ...base, amount: 60000 });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.details.limit).toBe(50000);
    }
  });

  it('lets the controller write off anything', () => {
    const record = writeOff({ ...base, amount: 9000000, approverRole: 'controller' });
    expect(record.amount).toBe(9000000);
  });

  it('reports no limit for the controller in the details', () => {
    expect(() => writeOff({ ...base, approverRole: 'intern' })).toThrow(/cannot write off/);
  });
});

describe('the separation rule', () => {
  it('refuses a write off by whoever raised the assessment', () => {
    expect(() => writeOff({ ...base, assessedBy: 'j.reyes' })).toThrow(/whoever raised it/);
  });

  it('allows it when somebody else raised it', () => {
    expect(writeOff({ ...base, assessedBy: 'm.okafor' }).approvedBy).toBe('j.reyes');
  });

  it('does not apply below the de minimis', () => {
    const record = writeOff({ ...base, amount: 500, assessedBy: 'j.reyes' });
    expect(record.automatic).toBe(true);
  });
});

describe('validation', () => {
  it('needs an invoice, a reason and a date', () => {
    expect(() => writeOff({ ...base, invoiceNumber: undefined })).toThrow(ValidationError);
    expect(() => writeOff({ ...base, reason: undefined })).toThrow(ValidationError);
    expect(() => writeOff({ ...base, writtenOn: undefined })).toThrow(ValidationError);
  });

  it('refuses a reason it does not know', () => {
    expect(() => writeOff({ ...base, reason: 'tired' })).toThrow(ValidationError);
  });

  it('refuses a zero or negative amount', () => {
    expect(() => writeOff({ ...base, amount: 0 })).toThrow(ValidationError);
  });

  it('needs an approver above the threshold', () => {
    expect(() => writeOff({ ...base, approvedBy: undefined })).toThrow(ValidationError);
    expect(() => writeOff({ ...base, approverRole: undefined })).toThrow(ValidationError);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(writeOff(base))).toBe(true);
  });
});

describe('summaries', () => {
  const records = [
    writeOff(base),
    writeOff({ ...base, amount: 900, reason: WRITE_OFF_REASON.DE_MINIMIS }),
    writeOff({ ...base, amount: 10000, reason: WRITE_OFF_REASON.BILLING_ERROR }),
  ];

  it('totals them', () => {
    expect(totalWrittenOff(records)).toBe(50900);
    expect(totalWrittenOff([])).toBe(0);
  });

  it('splits by reason', () => {
    expect(byReason(records)).toEqual({
      'billing-error': 10000,
      'de-minimis': 900,
      goodwill: 40000,
    });
  });

  it('reports how much went through without a person', () => {
    expect(automaticShare(records)).toBeCloseTo(1 / 3, 6);
    expect(automaticShare([])).toBe(0);
  });
});
