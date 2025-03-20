import { describe, expect, it } from 'vitest';
import {
  RELIEF_STYLE,
  applyDiscount,
  bonusFreeDays,
  contract,
  coversDay,
  coversPage,
  isEarned,
  optionalContractId,
  selectContract,
  shortfall,
} from '../../src/tariff/contract.js';
import { civilDate } from '../../src/time/civil.js';
import { ValidationError } from '../../src/core/errors.js';

const base = {
  id: 'C-2024-DELTA',
  consigneeId: ' delta ',
  from: '2024-01-01',
  to: '2024-12-31',
  minimumCars: 200,
  discountBasisPoints: 1500,
};

describe('contract', () => {
  it('uppercases the consignee', () => {
    expect(contract(base).consigneeId).toBe('DELTA');
  });

  it('is frozen down to the page list', () => {
    const record = contract({ ...base, pageIds: ['DEM-4000'] });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.pageIds)).toBe(true);
  });

  it('refuses a discount with no commitment behind it', () => {
    expect(() => contract({ ...base, minimumCars: 0 })).toThrow(/just a rate/);
  });

  it('allows a commitment that only buys free days', () => {
    const record = contract({ ...base, discountBasisPoints: 0, freeDayBonus: 1 });
    expect(record.freeDayBonus).toBe(1);
  });

  it('refuses a discount above a hundred percent', () => {
    expect(() => contract({ ...base, discountBasisPoints: 10001 })).toThrow(ValidationError);
  });

  it('refuses a style it does not know', () => {
    expect(() => contract({ ...base, style: 'sliding' })).toThrow(ValidationError);
  });
});

describe('scope', () => {
  const record = contract({ ...base, pageIds: ['DEM-4000'] });

  it('covers the days in its term', () => {
    expect(coversDay(record, civilDate(2024, 6, 1))).toBe(true);
    expect(coversDay(record, civilDate(2025, 1, 1))).toBe(false);
  });

  it('covers the pages it names', () => {
    expect(coversPage(record, 'DEM-4000')).toBe(true);
    expect(coversPage(record, 'DEM-4100')).toBe(false);
  });

  it('covers every page when it names none', () => {
    expect(coversPage(contract(base), 'anything')).toBe(true);
  });
});

describe('whether the commitment was met', () => {
  const record = contract(base);

  it('is earned at the minimum exactly', () => {
    expect(isEarned(record, 200)).toBe(true);
    expect(shortfall(record, 200)).toBe(0);
  });

  it('is not earned one car short', () => {
    expect(isEarned(record, 199)).toBe(false);
    expect(shortfall(record, 199)).toBe(1);
  });

  it('refuses a negative volume', () => {
    expect(() => isEarned(record, -1)).toThrow(ValidationError);
  });
});

describe('applying the discount', () => {
  const record = contract(base);

  it('gives nothing when the volume fell short', () => {
    expect(applyDiscount(record, 100000, { carsShipped: 190 })).toEqual({
      amount: 100000,
      discount: 0,
      earned: false,
    });
  });

  it('discounts every car once the volume is there', () => {
    expect(applyDiscount(record, 100000, { carsShipped: 200 })).toEqual({
      amount: 85000,
      discount: 15000,
      earned: true,
    });
  });

  it('charges the same car two prices on the same day depending on the month', () => {
    const short = applyDiscount(record, 100000, { carsShipped: 199 });
    const met = applyDiscount(record, 100000, { carsShipped: 200 });
    expect(short.amount).toBeGreaterThan(met.amount);
  });

  it('discounts only the excess cars when the style says so', () => {
    const excess = contract({ ...base, style: RELIEF_STYLE.EXCESS_ONLY });
    expect(applyDiscount(excess, 100000, { carsShipped: 250, carIndex: 200 }).discount).toBe(0);
    expect(applyDiscount(excess, 100000, { carsShipped: 250, carIndex: 201 }).discount).toBe(15000);
  });

  it('rounds the discount to a whole cent', () => {
    const odd = contract({ ...base, discountBasisPoints: 333 });
    expect(applyDiscount(odd, 10001, { carsShipped: 200 }).discount).toBe(333);
  });
});

describe('bonusFreeDays', () => {
  it('is given only once the commitment is met', () => {
    const record = contract({ ...base, freeDayBonus: 2 });
    expect(bonusFreeDays(record, 199)).toBe(0);
    expect(bonusFreeDays(record, 200)).toBe(2);
  });
});

describe('selectContract', () => {
  const contracts = [
    contract({ ...base, id: 'C-OLD', from: '2023-01-01', to: '2023-12-31' }),
    contract({ ...base, pageIds: ['DEM-4000'] }),
  ];

  it('finds the one covering the day and the page', () => {
    const found = selectContract(contracts, {
      consigneeId: 'delta',
      pageId: 'DEM-4000',
      on: civilDate(2024, 6, 1),
    });
    expect(found.id).toBe('C-2024-DELTA');
  });

  it('has nothing when the page is not covered', () => {
    expect(
      selectContract(contracts, {
        consigneeId: 'DELTA',
        pageId: 'DEM-4100',
        on: civilDate(2024, 6, 1),
      })
    ).toBeUndefined();
  });

  it('has nothing for another consignee', () => {
    expect(
      selectContract(contracts, {
        consigneeId: 'ACME',
        pageId: 'DEM-4000',
        on: civilDate(2024, 6, 1),
      })
    ).toBeUndefined();
  });

  it('needs a consignee', () => {
    expect(() => selectContract(contracts, { on: civilDate(2024, 6, 1) })).toThrow(ValidationError);
  });
});

describe('optionalContractId', () => {
  it('passes a value through and lets nothing through', () => {
    expect(optionalContractId('C-1')).toBe('C-1');
    expect(optionalContractId(undefined)).toBeUndefined();
  });
});
