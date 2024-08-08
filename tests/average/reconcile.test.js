import { describe, expect, it } from 'vitest';
import {
  creditUtilisation,
  describeSettlement,
  isSettledInFull,
  reconcile,
  runPeriods,
} from '../../src/average/reconcile.js';
import { averageAgreement } from '../../src/average/agreement.js';
import { ValidationError } from '../../src/core/errors.js';

const base = { id: 'AVG-1', consigneeId: 'DELTA', from: '2024-01-01', to: '2024-12-31' };
const plain = averageAgreement(base);
const carrying = averageAgreement({ ...base, carryOver: true });
const twoToOne = averageAgreement({ ...base, offsetRatio: 2 });

const ledger = (credits, debits) => [
  { carId: 'A', credits, debits: 0, covered: true },
  { carId: 'B', credits: 0, debits, covered: true },
];

describe('a month that balances', () => {
  it('offsets every debit', () => {
    const settlement = reconcile(ledger(4, 4), plain, { period: '202403' });
    expect(settlement.offsetDebits).toBe(4);
    expect(settlement.billableDebits).toBe(0);
    expect(isSettledInFull(settlement)).toBe(true);
  });

  it('spends exactly what it needed', () => {
    const settlement = reconcile(ledger(4, 4), plain, { period: '202403' });
    expect(settlement.creditsSpent).toBe(4);
    expect(settlement.creditsLeft).toBe(0);
  });
});

describe('a month with more debits than credits', () => {
  const settlement = reconcile(ledger(2, 6), plain, { period: '202403' });

  it('bills what the credits could not reach', () => {
    expect(settlement.offsetDebits).toBe(2);
    expect(settlement.billableDebits).toBe(4);
    expect(isSettledInFull(settlement)).toBe(false);
  });

  it('leaves no credits behind', () => {
    expect(settlement.creditsLeft).toBe(0);
  });
});

describe('a month with credits to spare', () => {
  it('expires them when the agreement does not carry', () => {
    const settlement = reconcile(ledger(9, 4), plain, { period: '202403' });
    expect(settlement.creditsLeft).toBe(5);
    expect(settlement.expiredCredits).toBe(5);
    expect(settlement.carriedOut).toBe(0);
  });

  it('carries them when it does', () => {
    const settlement = reconcile(ledger(9, 4), carrying, { period: '202403' });
    expect(settlement.carriedOut).toBe(5);
    expect(settlement.expiredCredits).toBe(0);
  });
});

describe('the opening balance', () => {
  it('is ignored on an agreement that does not carry', () => {
    const settlement = reconcile(ledger(0, 3), plain, { period: '202404', carriedIn: 10 });
    expect(settlement.openingCredits).toBe(0);
    expect(settlement.billableDebits).toBe(3);
  });

  it('is spent first on one that does', () => {
    const settlement = reconcile(ledger(0, 3), carrying, { period: '202404', carriedIn: 10 });
    expect(settlement.openingCredits).toBe(10);
    expect(settlement.billableDebits).toBe(0);
    expect(settlement.carriedOut).toBe(7);
  });

  it('refuses a negative opening balance', () => {
    expect(() => reconcile([], carrying, { period: '202404', carriedIn: -1 })).toThrow(
      ValidationError
    );
  });
});

describe('the ratio', () => {
  it('makes two credits buy one debit', () => {
    const settlement = reconcile(ledger(6, 6), twoToOne, { period: '202403' });
    expect(settlement.offsetDebits).toBe(3);
    expect(settlement.creditsSpent).toBe(6);
    expect(settlement.billableDebits).toBe(3);
  });

  it('leaves an odd credit unspent', () => {
    const settlement = reconcile(ledger(7, 6), twoToOne, { period: '202403' });
    expect(settlement.offsetDebits).toBe(3);
    expect(settlement.creditsLeft).toBe(1);
  });
});

describe('utilisation', () => {
  it('is the share of credits actually used', () => {
    expect(creditUtilisation(reconcile(ledger(8, 4), plain, { period: '202403' }))).toBe(0.5);
  });

  it('is zero when there were none', () => {
    expect(creditUtilisation(reconcile(ledger(0, 4), plain, { period: '202403' }))).toBe(0);
  });
});

describe('running several months', () => {
  const months = new Map([
    ['202403', ledger(9, 4)],
    ['202404', ledger(0, 3)],
    ['202405', ledger(0, 6)],
  ]);

  it('carries the balance forward when the agreement carries', () => {
    const settlements = runPeriods(months, carrying);
    expect(settlements.map((entry) => entry.billableDebits)).toEqual([0, 0, 4]);
  });

  it('starts every month at nothing when it does not', () => {
    const settlements = runPeriods(months, plain);
    expect(settlements.map((entry) => entry.billableDebits)).toEqual([0, 3, 6]);
  });

  it('runs the months in order whatever order they were given in', () => {
    const shuffled = new Map([
      ['202405', ledger(0, 6)],
      ['202403', ledger(9, 4)],
      ['202404', ledger(0, 3)],
    ]);
    expect(runPeriods(shuffled, carrying).map((entry) => entry.period)).toEqual([
      '202403',
      '202404',
      '202405',
    ]);
  });

  it('handles no months at all', () => {
    expect(runPeriods(new Map(), carrying)).toEqual([]);
  });
});

describe('describeSettlement', () => {
  it('reads the three numbers a clerk checks', () => {
    const settlement = reconcile(ledger(2, 6), plain, { period: '202403' });
    expect(describeSettlement(settlement)).toBe('202403 DELTA: 6 debits, 2 offset, 4 billable');
  });

  it('needs a period', () => {
    expect(() => reconcile([], plain, {})).toThrow(ValidationError);
  });
});
