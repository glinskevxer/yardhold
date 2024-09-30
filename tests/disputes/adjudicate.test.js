import { describe, expect, it } from 'vitest';
import {
  adjudicate,
  adjudicateWithSubstitutions,
  filterSubstitutions,
  mayReopen,
  reopenableInputs,
  totalAllowed,
} from '../../src/disputes/adjudicate.js';
import { CLAIM_STATUS, GROUND, claim } from '../../src/disputes/claim.js';
import { ValidationError } from '../../src/core/errors.js';

const base = {
  sequence: 4,
  period: '202404',
  invoiceNumber: 'INV-202403-00012',
  consigneeId: 'DELTA',
  ground: GROUND.RELIEF_NOT_GIVEN,
  filedOn: '2024-04-18',
  amountClaimed: 45000,
  evidence: ['BNSF SA-2024-113'],
};

describe('what each ground opens', () => {
  it('opens the event stream on a wrong events claim', () => {
    expect(reopenableInputs(GROUND.WRONG_EVENTS)).toEqual(['events']);
  });

  it('opens the relief on a relief claim', () => {
    expect(reopenableInputs(GROUND.RELIEF_NOT_GIVEN)).toEqual(['exclusions']);
  });

  it('opens the page on a tariff claim', () => {
    expect(mayReopen(GROUND.WRONG_TARIFF, 'page')).toBe(true);
    expect(mayReopen(GROUND.WRONG_TARIFF, 'events')).toBe(false);
  });

  it('opens both the orders and the relief on a bunching claim', () => {
    expect(reopenableInputs(GROUND.BUNCHING).sort()).toEqual(['exclusions', 'orders']);
  });

  it('opens nothing on an arithmetic claim', () => {
    expect(reopenableInputs(GROUND.ARITHMETIC)).toEqual([]);
  });

  it('opens nothing for a ground it does not know', () => {
    expect(reopenableInputs('unhappy')).toEqual([]);
  });
});

describe('filterSubstitutions', () => {
  it('keeps what the ground opened', () => {
    const { allowed, refused } = filterSubstitutions(GROUND.RELIEF_NOT_GIVEN, {
      exclusions: ['storm'],
    });
    expect(allowed).toEqual({ exclusions: ['storm'] });
    expect(refused).toEqual([]);
  });

  it('drops what it did not, and names it', () => {
    const { allowed, refused } = filterSubstitutions(GROUND.RELIEF_NOT_GIVEN, {
      exclusions: ['storm'],
      events: ['earlier release'],
    });
    expect(Object.keys(allowed)).toEqual(['exclusions']);
    expect(refused).toEqual(['events']);
  });

  it('drops everything on an arithmetic claim', () => {
    const { allowed, refused } = filterSubstitutions(GROUND.ARITHMETIC, { events: [], page: {} });
    expect(allowed).toEqual({});
    expect(refused.sort()).toEqual(['events', 'page']);
  });

  it('handles no substitutions at all', () => {
    expect(filterSubstitutions(GROUND.ARITHMETIC)).toEqual({ allowed: {}, refused: [] });
  });
});

describe('adjudicate', () => {
  const record = claim(base);

  it('allows the claim in full when the recomputation covered it', () => {
    const decision = adjudicate(record, { originalTotal: 100000, revisedTotal: 40000 });
    expect(decision.status).toBe(CLAIM_STATUS.ALLOWED);
    expect(decision.allowedAmount).toBe(45000);
  });

  it('allows exactly the claim when the difference matches', () => {
    const decision = adjudicate(record, { originalTotal: 100000, revisedTotal: 55000 });
    expect(decision.status).toBe(CLAIM_STATUS.ALLOWED);
    expect(decision.allowedAmount).toBe(45000);
  });

  it('allows only the difference when it falls short', () => {
    const decision = adjudicate(record, { originalTotal: 100000, revisedTotal: 80000 });
    expect(decision.status).toBe(CLAIM_STATUS.ALLOWED_IN_PART);
    expect(decision.allowedAmount).toBe(20000);
  });

  it('denies a recomputation that changed nothing', () => {
    const decision = adjudicate(record, { originalTotal: 100000, revisedTotal: 100000 });
    expect(decision.status).toBe(CLAIM_STATUS.DENIED);
    expect(decision.allowedAmount).toBe(0);
  });

  it('denies a recomputation that made it worse', () => {
    expect(adjudicate(record, { originalTotal: 100000, revisedTotal: 120000 }).status).toBe(
      CLAIM_STATUS.DENIED
    );
  });

  it('denies when nothing was recomputed at all', () => {
    const decision = adjudicate(record, {});
    expect(decision.status).toBe(CLAIM_STATUS.DENIED);
    expect(decision.reason).toBe('nothing was recomputed');
  });

  it('needs a claim', () => {
    expect(() => adjudicate(undefined, { originalTotal: 1, revisedTotal: 0 })).toThrow(
      ValidationError
    );
  });
});

describe('adjudicateWithSubstitutions', () => {
  it('recomputes with only the inputs the ground opened', () => {
    const record = claim(base);
    const decision = adjudicateWithSubstitutions(record, {
      originalTotal: 100000,
      substitutions: { exclusions: ['storm'], events: ['earlier release'] },
      recompute: (inputs) => (inputs.exclusions ? 70000 : 100000),
    });
    expect(decision.status).toBe(CLAIM_STATUS.ALLOWED_IN_PART);
    expect(decision.appliedInputs).toEqual(['exclusions']);
    expect(decision.refusedInputs).toEqual(['events']);
  });

  it('denies a claim whose real ground was never opened', () => {
    const record = claim(base);
    const decision = adjudicateWithSubstitutions(record, {
      originalTotal: 100000,
      substitutions: { events: ['earlier release'] },
      recompute: (inputs) => (inputs.events ? 40000 : 100000),
    });
    expect(decision.status).toBe(CLAIM_STATUS.DENIED);
    expect(decision.refusedInputs).toEqual(['events']);
  });

  it('allows the same facts once filed on the right ground', () => {
    const record = claim({ ...base, ground: GROUND.WRONG_EVENTS, evidence: ['gate log'] });
    const decision = adjudicateWithSubstitutions(record, {
      originalTotal: 100000,
      substitutions: { events: ['earlier release'] },
      recompute: (inputs) => (inputs.events ? 40000 : 100000),
    });
    expect(decision.status).toBe(CLAIM_STATUS.ALLOWED);
  });
});

describe('totalAllowed', () => {
  it('adds up a set of decisions', () => {
    expect(totalAllowed([{ allowedAmount: 100 }, { allowedAmount: 250 }])).toBe(350);
    expect(totalAllowed([])).toBe(0);
  });
});
