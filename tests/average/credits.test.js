import { describe, expect, it } from 'vitest';
import {
  carCredit,
  coveredCars,
  creditLedger,
  excludedCars,
  totalCredits,
  totalDebits,
} from '../../src/average/credits.js';
import { CREDIT_BASIS, averageAgreement } from '../../src/average/agreement.js';
import { ValidationError } from '../../src/core/errors.js';

const base = { id: 'AVG-1', consigneeId: 'DELTA', from: '2024-01-01', to: '2024-12-31' };
const freeDay = averageAgreement(base);
const perCar = averageAgreement({ ...base, creditBasis: CREDIT_BASIS.CAR, creditCapPerCar: 1 });

const assessment = (carId, chargeableDays, counts) => ({ carId, chargeableDays, counts });
const count = (allowance, freeUsed) => ({ allowance, freeUsed });

describe('a car that went over', () => {
  it('earns debits and no credits', () => {
    const entry = carCredit(assessment('A', 3, [count(2, 2)]), freeDay);
    expect(entry).toEqual({ carId: 'A', credits: 0, debits: 3, covered: true });
  });
});

describe('a car that turned round in time', () => {
  it('earns a credit for each unused free day', () => {
    const entry = carCredit(assessment('A', 0, [count(3, 1)]), freeDay);
    expect(entry.credits).toBe(2);
  });

  it('earns one credit per car on a car basis however much was left', () => {
    expect(carCredit(assessment('A', 0, [count(3, 1)]), perCar).credits).toBe(1);
    expect(carCredit(assessment('A', 0, [count(3, 3)]), perCar).credits).toBe(1);
  });

  it('earns nothing on a free day basis when it used the whole allowance', () => {
    expect(carCredit(assessment('A', 0, [count(3, 3)]), freeDay).credits).toBe(0);
  });

  it('adds up unused days across respots', () => {
    expect(carCredit(assessment('A', 0, [count(2, 1), count(2, 0)]), freeDay).credits).toBe(3);
  });

  it('holds a credit to the cap', () => {
    const capped = averageAgreement({ ...base, creditCapPerCar: 2 });
    expect(carCredit(assessment('A', 0, [count(9, 0)]), capped).credits).toBe(2);
  });
});

describe('relief that was granted rather than earned', () => {
  it('does not earn a credit by default', () => {
    const entry = carCredit(assessment('A', 0, [count(4, 1)]), freeDay, { extraFreeDays: 2 });
    expect(entry.credits).toBe(1);
  });

  it('cannot push the credit below zero', () => {
    const entry = carCredit(assessment('A', 0, [count(2, 1)]), freeDay, { extraFreeDays: 5 });
    expect(entry.credits).toBe(0);
  });

  it('counts it when the agreement says to', () => {
    const counting = averageAgreement({ ...base, countsBunchingRelief: true });
    const entry = carCredit(assessment('A', 0, [count(4, 1)]), counting, { extraFreeDays: 2 });
    expect(entry.credits).toBe(3);
  });

  it('is ignored entirely on a car basis', () => {
    expect(carCredit(assessment('A', 0, [count(4, 1)]), perCar, { extraFreeDays: 2 }).credits).toBe(
      1
    );
  });
});

describe('cars the agreement does not cover', () => {
  it('leaves a private car out of both columns', () => {
    const entry = carCredit(assessment('A', 4, [count(2, 2)]), freeDay, {
      car: { ownership: 'private' },
    });
    expect(entry).toEqual({ carId: 'A', credits: 0, debits: 0, covered: false });
  });

  it('takes it in when the agreement covers private cars', () => {
    const wide = averageAgreement({ ...base, coversPrivateCars: true });
    const entry = carCredit(assessment('A', 4, [count(2, 2)]), wide, {
      car: { ownership: 'private' },
    });
    expect(entry.debits).toBe(4);
  });

  it('needs an agreement', () => {
    expect(() => carCredit(assessment('A', 0, []), undefined)).toThrow(ValidationError);
  });
});

describe('the ledger', () => {
  const assessments = [
    assessment('A', 0, [count(2, 0)]),
    assessment('B', 3, [count(2, 2)]),
    assessment('C', 0, [count(2, 2)]),
  ];

  it('runs every car through the same agreement', () => {
    const ledger = creditLedger(assessments, freeDay);
    expect(totalCredits(ledger)).toBe(2);
    expect(totalDebits(ledger)).toBe(3);
  });

  it('reads the bunching relief per car', () => {
    const ledger = creditLedger(assessments, freeDay, {
      extraFreeDays: new Map([['A', 1]]),
    });
    expect(totalCredits(ledger)).toBe(1);
  });

  it('reads the car record per car', () => {
    const ledger = creditLedger(assessments, freeDay, {
      cars: new Map([['B', { ownership: 'private' }]]),
    });
    expect(totalDebits(ledger)).toBe(0);
    expect(excludedCars(ledger)).toEqual(['B']);
    expect(coveredCars(ledger)).toEqual(['A', 'C']);
  });

  it('gives a different total under the two bases', () => {
    expect(totalCredits(creditLedger(assessments, freeDay))).toBe(2);
    expect(totalCredits(creditLedger(assessments, perCar))).toBe(2);
    const generous = [assessment('A', 0, [count(5, 0)])];
    expect(totalCredits(creditLedger(generous, freeDay))).toBe(5);
    expect(totalCredits(creditLedger(generous, perCar))).toBe(1);
  });

  it('handles an empty month', () => {
    expect(creditLedger([], freeDay)).toEqual([]);
    expect(totalCredits([])).toBe(0);
  });
});
