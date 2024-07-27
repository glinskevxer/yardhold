import { describe, expect, it } from 'vitest';
import {
  CREDIT_BASIS,
  averageAgreement,
  coversCar,
  coversDay,
  coversStation,
  creditsNeededFor,
  creditsPerFreeDay,
  debitsCoveredBy,
  describeAgreement,
} from '../../src/average/agreement.js';
import { civilDate } from '../../src/time/civil.js';
import { ValidationError } from '../../src/core/errors.js';

const base = {
  id: 'AVG-2024-3',
  consigneeId: ' delta ',
  from: '2024-01-01',
  to: '2024-12-31',
};

describe('building an agreement', () => {
  it('uppercases the consignee', () => {
    expect(averageAgreement(base).consigneeId).toBe('DELTA');
  });

  it('defaults to free day credits at one to one', () => {
    const agreement = averageAgreement(base);
    expect(agreement.creditBasis).toBe(CREDIT_BASIS.FREE_DAY);
    expect(agreement.offsetRatio).toBe(1);
    expect(creditsPerFreeDay(agreement)).toBe(true);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(averageAgreement(base))).toBe(true);
  });

  it('needs an id, a consignee and a term', () => {
    expect(() => averageAgreement({ ...base, id: undefined })).toThrow(ValidationError);
    expect(() => averageAgreement({ ...base, consigneeId: undefined })).toThrow(ValidationError);
    expect(() => averageAgreement({ ...base, to: undefined })).toThrow(ValidationError);
  });

  it('refuses a ratio outside the range', () => {
    expect(() => averageAgreement({ ...base, offsetRatio: 0 })).toThrow(ValidationError);
    expect(() => averageAgreement({ ...base, offsetRatio: 11 })).toThrow(ValidationError);
  });

  it('refuses a car basis that caps above one credit', () => {
    expect(() =>
      averageAgreement({ ...base, creditBasis: CREDIT_BASIS.CAR, creditCapPerCar: 3 })
    ).toThrow(/one credit/);
    expect(
      averageAgreement({ ...base, creditBasis: CREDIT_BASIS.CAR, creditCapPerCar: 1 })
        .creditCapPerCar
    ).toBe(1);
  });

  it('refuses a basis it does not know', () => {
    expect(() => averageAgreement({ ...base, creditBasis: 'weighted' })).toThrow(ValidationError);
  });
});

describe('scope', () => {
  const agreement = averageAgreement({ ...base, splc: '412300' });

  it('covers days inside its term', () => {
    expect(coversDay(agreement, civilDate(2024, 6, 1))).toBe(true);
    expect(coversDay(agreement, civilDate(2025, 1, 1))).toBe(false);
  });

  it('covers the station it names', () => {
    expect(coversStation(agreement, '412300')).toBe(true);
    expect(coversStation(agreement, '509100')).toBe(false);
  });

  it('covers every station when it names none', () => {
    expect(coversStation(averageAgreement(base), '509100')).toBe(true);
  });

  it('leaves private cars out unless it says otherwise', () => {
    const railroad = { ownership: 'railroad' };
    const priv = { ownership: 'private' };
    expect(coversCar(agreement, railroad)).toBe(true);
    expect(coversCar(agreement, priv)).toBe(false);
    expect(coversCar(averageAgreement({ ...base, coversPrivateCars: true }), priv)).toBe(true);
  });

  it('covers a car it was told nothing about', () => {
    expect(coversCar(agreement, undefined)).toBe(true);
  });
});

describe('the ratio', () => {
  it('offsets one for one by default', () => {
    const agreement = averageAgreement(base);
    expect(debitsCoveredBy(agreement, 7)).toBe(7);
    expect(creditsNeededFor(agreement, 7)).toBe(7);
  });

  it('makes two credits buy one debit at two to one', () => {
    const agreement = averageAgreement({ ...base, offsetRatio: 2 });
    expect(debitsCoveredBy(agreement, 7)).toBe(3);
    expect(creditsNeededFor(agreement, 3)).toBe(6);
  });

  it('rounds a leftover credit away rather than half covering a debit', () => {
    const agreement = averageAgreement({ ...base, offsetRatio: 3 });
    expect(debitsCoveredBy(agreement, 8)).toBe(2);
  });
});

describe('describeAgreement', () => {
  it('reads the basis and the ratio', () => {
    expect(describeAgreement(averageAgreement({ ...base, offsetRatio: 2 }))).toBe(
      'AVG-2024-3 DELTA on free-day at 2 to 1'
    );
  });
});
