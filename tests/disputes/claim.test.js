import { describe, expect, it } from 'vitest';
import {
  CLAIM_STATUS,
  GROUND,
  claim,
  claimsAgainst,
  describeClaim,
  isAllowed,
  isDecided,
  openClaims,
  withClaimStatus,
} from '../../src/disputes/claim.js';
import { ValidationError } from '../../src/core/errors.js';

const base = {
  sequence: 4,
  period: '202404',
  invoiceNumber: 'INV-202403-00012',
  consigneeId: ' delta ',
  ground: GROUND.RELIEF_NOT_GIVEN,
  filedOn: '2024-04-18',
  cars: ['BNSF 400123'],
  amountClaimed: 45000,
  evidence: ['BNSF SA-2024-113'],
};

describe('filing a claim', () => {
  it('numbers itself', () => {
    expect(claim(base).number).toBe('CLM-202404-00004');
  });

  it('uppercases the consignee', () => {
    expect(claim(base).consigneeId).toBe('DELTA');
  });

  it('is frozen down to the cars and the evidence', () => {
    const record = claim(base);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.cars)).toBe(true);
    expect(Object.isFrozen(record.evidence)).toBe(true);
  });

  it('starts filed', () => {
    expect(claim(base).status).toBe(CLAIM_STATUS.FILED);
    expect(isDecided(claim(base))).toBe(false);
  });

  it('needs an invoice, a consignee and a ground', () => {
    expect(() => claim({ ...base, invoiceNumber: undefined })).toThrow(ValidationError);
    expect(() => claim({ ...base, consigneeId: undefined })).toThrow(ValidationError);
    expect(() => claim({ ...base, ground: undefined })).toThrow(ValidationError);
  });

  it('refuses a ground it does not know', () => {
    expect(() => claim({ ...base, ground: 'unhappy' })).toThrow(ValidationError);
  });

  it('needs an amount above zero in whole cents', () => {
    expect(() => claim({ ...base, amountClaimed: 0 })).toThrow(/above zero/);
    expect(() => claim({ ...base, amountClaimed: -1 })).toThrow(/above zero/);
    expect(() => claim({ ...base, amountClaimed: 45.5 })).toThrow(/whole cent/);
  });
});

describe('evidence', () => {
  it('is required on every ground but arithmetic', () => {
    expect(() => claim({ ...base, evidence: [] })).toThrow(/needs evidence/);
  });

  it('is not required to claim the sum was added up wrong', () => {
    const record = claim({ ...base, ground: GROUND.ARITHMETIC, evidence: [] });
    expect(record.evidence).toEqual([]);
  });

  it('is required for a wrong tariff claim', () => {
    expect(() => claim({ ...base, ground: GROUND.WRONG_TARIFF, evidence: [] })).toThrow(
      /needs evidence/
    );
  });
});

describe('status', () => {
  it('moves to a decision', () => {
    const allowed = withClaimStatus(claim(base), CLAIM_STATUS.ALLOWED);
    expect(isDecided(allowed)).toBe(true);
    expect(isAllowed(allowed)).toBe(true);
  });

  it('counts a partial allowance as allowed', () => {
    expect(isAllowed(withClaimStatus(claim(base), CLAIM_STATUS.ALLOWED_IN_PART))).toBe(true);
  });

  it('does not count a denial as allowed', () => {
    const denied = withClaimStatus(claim(base), CLAIM_STATUS.DENIED);
    expect(isDecided(denied)).toBe(true);
    expect(isAllowed(denied)).toBe(false);
  });

  it('will not reopen a withdrawn claim', () => {
    const withdrawn = withClaimStatus(claim(base), CLAIM_STATUS.WITHDRAWN);
    expect(() => withClaimStatus(withdrawn, CLAIM_STATUS.ALLOWED)).toThrow(/cannot be reopened/);
  });

  it('leaves the original alone', () => {
    const filed = claim(base);
    withClaimStatus(filed, CLAIM_STATUS.DENIED);
    expect(filed.status).toBe(CLAIM_STATUS.FILED);
  });

  it('refuses a status it does not know', () => {
    expect(() => withClaimStatus(claim(base), 'pending-ish')).toThrow(ValidationError);
  });
});

describe('working with a set of claims', () => {
  const claims = [
    claim(base),
    claim({ ...base, sequence: 5, invoiceNumber: 'INV-202403-00013' }),
    withClaimStatus(claim({ ...base, sequence: 6 }), CLAIM_STATUS.DENIED),
  ];

  it('finds the claims against one invoice', () => {
    expect(claimsAgainst(claims, 'INV-202403-00012')).toHaveLength(2);
    expect(claimsAgainst(claims, 'INV-202403-99999')).toEqual([]);
  });

  it('finds the ones still open', () => {
    expect(openClaims(claims)).toHaveLength(2);
  });
});

describe('describeClaim', () => {
  it('names the invoice, the ground and the money', () => {
    expect(describeClaim(claim(base))).toBe(
      'CLM-202404-00004 against INV-202403-00012 on relief-not-given for 45000'
    );
  });
});
