import { describe, expect, it } from 'vitest';
import {
  CHARGE_TYPE,
  describeLine,
  lineItem,
  lineTotal,
  linesForCar,
  linesOfType,
  subtotalsByType,
  taxableTotal,
} from '../../src/invoice/lineItem.js';
import { ValidationError } from '../../src/core/errors.js';

const demurrage = (amount, extra = {}) =>
  lineItem({
    type: CHARGE_TYPE.DEMURRAGE,
    carId: 'BNSF 400123',
    date: '2024-03-07',
    unitAmount: amount,
    ...extra,
  });

describe('lineItem', () => {
  it('multiplies the unit by the quantity', () => {
    expect(demurrage(15000, { quantity: 3 }).amount).toBe(45000);
  });

  it('defaults the quantity to one', () => {
    expect(demurrage(15000).quantity).toBe(1);
  });

  it('normalises the date', () => {
    expect(demurrage(15000).date).toBe('2024-03-07');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(demurrage(15000))).toBe(true);
  });

  it('gives each type a default description', () => {
    expect(lineItem({ type: CHARGE_TYPE.STORAGE, unitAmount: 100 }).description).toBe(
      'private car storage'
    );
    expect(lineItem({ type: CHARGE_TYPE.SWITCHING, unitAmount: 100 }).description).toBe(
      'switching'
    );
    expect(lineItem({ type: CHARGE_TYPE.CAR_HIRE, unitAmount: 100 }).description).toBe('car hire');
    expect(lineItem({ type: CHARGE_TYPE.ADJUSTMENT, unitAmount: 100 }).description).toBe(
      'adjustment'
    );
    expect(lineItem({ type: CHARGE_TYPE.CREDIT, unitAmount: -100 }).description).toBe('credit');
  });

  it('takes a description of its own', () => {
    expect(demurrage(15000, { description: 'day 3 of 5' }).description).toBe('day 3 of 5');
  });

  it('refuses a type it does not know', () => {
    expect(() => lineItem({ type: 'fuel', unitAmount: 100 })).toThrow(ValidationError);
  });

  it('refuses an amount that is not whole cents', () => {
    expect(() => demurrage(150.5)).toThrow(/whole cent/);
    expect(() => demurrage(undefined)).toThrow(/whole cent/);
  });

  it('refuses a negative charge that is not a credit', () => {
    expect(() => demurrage(-100)).toThrow(/only a credit/);
    expect(lineItem({ type: CHARGE_TYPE.CREDIT, unitAmount: -100 }).amount).toBe(-100);
    expect(lineItem({ type: CHARGE_TYPE.ADJUSTMENT, unitAmount: -100 }).amount).toBe(-100);
  });

  it('refuses a quantity outside the range', () => {
    expect(() => demurrage(100, { quantity: 0 })).toThrow(ValidationError);
  });
});

describe('working with lines', () => {
  const lines = [
    demurrage(15000),
    demurrage(22500, { carId: 'GATX 77' }),
    lineItem({ type: CHARGE_TYPE.SWITCHING, unitAmount: 34000, taxable: true }),
    lineItem({ type: CHARGE_TYPE.CREDIT, unitAmount: -5000 }),
  ];

  it('totals them', () => {
    expect(lineTotal(lines)).toBe(66500);
    expect(lineTotal([])).toBe(0);
  });

  it('slices by type and by car', () => {
    expect(linesOfType(lines, CHARGE_TYPE.DEMURRAGE)).toHaveLength(2);
    expect(linesForCar(lines, 'GATX 77')).toHaveLength(1);
    expect(linesForCar(lines, 'UP 1')).toEqual([]);
  });

  it('subtotals by type in order', () => {
    expect(subtotalsByType(lines)).toEqual({
      credit: -5000,
      demurrage: 37500,
      switching: 34000,
    });
  });

  it('totals only the taxable lines', () => {
    expect(taxableTotal(lines)).toBe(34000);
  });

  it('subtotals nothing for nothing', () => {
    expect(subtotalsByType([])).toEqual({});
  });
});

describe('describeLine', () => {
  it('names the car, the day and the money', () => {
    expect(describeLine(demurrage(15000))).toBe('BNSF 400123 2024-03-07 demurrage $150.00');
  });

  it('leaves out what is not there', () => {
    expect(describeLine(lineItem({ type: CHARGE_TYPE.SWITCHING, unitAmount: 34000 }))).toBe(
      'switching $340.00'
    );
  });
});
