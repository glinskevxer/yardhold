import { describe, expect, it } from 'vitest';
import {
  allocateOverCars,
  creditMemo,
  creditedForCar,
  describeMemo,
  memoFor,
  remainingOn,
  totalCredited,
} from '../../src/disputes/creditMemo.js';
import { ValidationError } from '../../src/core/errors.js';

const base = {
  sequence: 3,
  period: '202404',
  invoiceNumber: 'INV-202403-00012',
  consigneeId: ' delta ',
  amount: 45000,
  reason: 'March storm allowed on claim CLM-202404-00004',
  claimNumber: 'CLM-202404-00004',
  issuedOn: '2024-04-30',
};

const lines = [
  { carId: 'BNSF 400123', amount: 30000 },
  { carId: 'GATX 77', amount: 60000 },
  { carId: undefined, amount: 34000 },
  { carId: 'UP 3', amount: 0 },
];

describe('creditMemo', () => {
  it('numbers itself and uppercases the consignee', () => {
    const memo = creditMemo(base);
    expect(memo.number).toBe('CRM-202404-00003');
    expect(memo.consigneeId).toBe('DELTA');
  });

  it('is frozen down to the allocations', () => {
    const memo = creditMemo(base);
    expect(Object.isFrozen(memo)).toBe(true);
    expect(Object.isFrozen(memo.allocations)).toBe(true);
  });

  it('needs an invoice, a consignee and a reason', () => {
    expect(() => creditMemo({ ...base, invoiceNumber: undefined })).toThrow(ValidationError);
    expect(() => creditMemo({ ...base, consigneeId: undefined })).toThrow(ValidationError);
    expect(() => creditMemo({ ...base, reason: undefined })).toThrow(ValidationError);
  });

  it('needs a whole cent amount above zero', () => {
    expect(() => creditMemo({ ...base, amount: 0 })).toThrow(/above zero/);
    expect(() => creditMemo({ ...base, amount: 45.5 })).toThrow(/whole cent/);
  });

  it('stands with no allocations at all', () => {
    expect(creditMemo(base).allocations).toEqual([]);
  });

  it('refuses allocations that do not foot', () => {
    expect(() =>
      creditMemo({ ...base, allocations: [{ carId: 'BNSF 400123', amount: 40000 }] })
    ).toThrow(/do not foot/);
  });

  it('accepts allocations that do', () => {
    const memo = creditMemo({
      ...base,
      allocations: [
        { carId: 'BNSF 400123', amount: 15000 },
        { carId: 'GATX 77', amount: 30000 },
      ],
    });
    expect(memo.allocations).toHaveLength(2);
  });
});

describe('allocateOverCars', () => {
  it('spreads in proportion to what each car was billed', () => {
    expect(allocateOverCars(45000, lines)).toEqual([
      { carId: 'BNSF 400123', amount: 15000 },
      { carId: 'GATX 77', amount: 30000 },
    ]);
  });

  it('foots exactly on an awkward split', () => {
    const shares = allocateOverCars(10000, [
      { carId: 'A', amount: 100 },
      { carId: 'B', amount: 100 },
      { carId: 'C', amount: 100 },
    ]);
    expect(shares.reduce((sum, entry) => sum + entry.amount, 0)).toBe(10000);
  });

  it('leaves out lines with no car and lines with nothing on them', () => {
    const shares = allocateOverCars(45000, lines);
    expect(shares.map((entry) => entry.carId)).not.toContain('UP 3');
    expect(shares).toHaveLength(2);
  });

  it('has nothing to spread over when no car was billed', () => {
    expect(allocateOverCars(45000, [{ amount: 34000 }])).toEqual([]);
  });

  it('feeds straight into a memo', () => {
    const memo = creditMemo({ ...base, allocations: allocateOverCars(45000, lines) });
    expect(memoFor(memo, 'GATX 77')).toBe(30000);
    expect(memoFor(memo, 'UP 3')).toBe(0);
  });
});

describe('reading a set of memos', () => {
  const memos = [
    creditMemo({ ...base, allocations: allocateOverCars(45000, lines) }),
    creditMemo({
      ...base,
      sequence: 4,
      amount: 10000,
      allocations: allocateOverCars(10000, lines),
    }),
    creditMemo({ ...base, sequence: 5, invoiceNumber: 'INV-202403-00013', amount: 5000 }),
  ];

  it('totals against one invoice', () => {
    expect(totalCredited(memos, 'INV-202403-00012')).toBe(55000);
    expect(totalCredited(memos, 'INV-999999-00001')).toBe(0);
  });

  it('totals everything when no invoice is named', () => {
    expect(totalCredited(memos)).toBe(60000);
  });

  it('totals what one car has already had back', () => {
    expect(creditedForCar(memos, 'BNSF 400123')).toBe(15000 + 3333);
    expect(creditedForCar(memos, 'UP 3')).toBe(0);
  });

  it('reports what is left on the invoice', () => {
    expect(remainingOn(124000, memos, 'INV-202403-00012')).toBe(69000);
  });

  it('never reports a negative remainder', () => {
    expect(remainingOn(10000, memos, 'INV-202403-00012')).toBe(0);
  });
});

describe('describeMemo', () => {
  it('names the claim when there is one', () => {
    expect(describeMemo(creditMemo(base))).toBe(
      'CRM-202404-00003 against INV-202403-00012 on CLM-202404-00004 for 45000'
    );
  });

  it('leaves the claim out when there is none', () => {
    expect(describeMemo(creditMemo({ ...base, claimNumber: undefined }))).toBe(
      'CRM-202404-00003 against INV-202403-00012 for 45000'
    );
  });
});
