import { describe, expect, it } from 'vitest';
import {
  ZERO_MILES,
  ZERO_RATE,
  addQuantity,
  compareQuantity,
  formatQuantity,
  multiplyQuantity,
  parseQuantity,
  quantity,
  rescale,
  subtractQuantity,
  toNumber,
} from '../../src/core/quantity.js';
import { ValidationError } from '../../src/core/errors.js';

describe('quantity', () => {
  it('holds units and a scale', () => {
    expect(quantity(12345, 2)).toEqual({ units: 12345, scale: 2 });
  });

  it('refuses fractional units', () => {
    expect(() => quantity(1.5, 2)).toThrow(ValidationError);
  });

  it('refuses an out of range scale', () => {
    expect(() => quantity(1, -1)).toThrow(ValidationError);
    expect(() => quantity(1, 9)).toThrow(ValidationError);
  });
});

describe('parseQuantity', () => {
  it('infers the scale from the literal', () => {
    expect(parseQuantity('3.1416')).toEqual({ units: 31416, scale: 4 });
    expect(parseQuantity('42')).toEqual({ units: 42, scale: 0 });
  });

  it('pads to a wider requested scale', () => {
    expect(parseQuantity('1.5', 4)).toEqual({ units: 15000, scale: 4 });
  });

  it('refuses to silently drop precision', () => {
    expect(() => parseQuantity('1.23456', 4)).toThrow(ValidationError);
  });

  it('reads negatives', () => {
    expect(parseQuantity('-0.25', 2)).toEqual({ units: -25, scale: 2 });
  });

  it('refuses junk', () => {
    expect(() => parseQuantity('1,000')).toThrow(ValidationError);
    expect(() => parseQuantity(5)).toThrow(ValidationError);
  });
});

describe('rescale', () => {
  it('widens exactly', () => {
    expect(rescale(quantity(15, 1), 4)).toEqual({ units: 15000, scale: 4 });
  });

  it('narrows by rounding half away from zero', () => {
    expect(rescale(quantity(1250, 4), 2)).toEqual({ units: 13, scale: 2 });
    expect(rescale(quantity(-1250, 4), 2)).toEqual({ units: -13, scale: 2 });
  });

  it('is a no op at the same scale', () => {
    const value = quantity(5, 2);
    expect(rescale(value, 2)).toBe(value);
  });
});

describe('arithmetic', () => {
  it('aligns scales before adding', () => {
    expect(addQuantity(quantity(15, 1), quantity(2500, 4))).toEqual({ units: 17500, scale: 4 });
  });

  it('subtracts', () => {
    expect(subtractQuantity(quantity(100, 2), quantity(1, 0))).toEqual({ units: 0, scale: 2 });
  });

  it('multiplies by a whole factor', () => {
    expect(multiplyQuantity(quantity(125, 2), 4)).toEqual({ units: 500, scale: 2 });
    expect(() => multiplyQuantity(quantity(1, 0), 0.5)).toThrow(ValidationError);
  });

  it('compares across scales', () => {
    expect(compareQuantity(quantity(15, 1), quantity(150, 2))).toBe(0);
    expect(compareQuantity(quantity(15, 1), quantity(151, 2))).toBe(-1);
    expect(compareQuantity(quantity(16, 1), quantity(151, 2))).toBe(1);
  });
});

describe('rendering', () => {
  it('converts to a number for reporting only', () => {
    expect(toNumber(quantity(31416, 4))).toBeCloseTo(3.1416, 6);
  });

  it('formats with the stored scale', () => {
    expect(formatQuantity(quantity(31416, 4))).toBe('3.1416');
    expect(formatQuantity(quantity(42, 0))).toBe('42');
    expect(formatQuantity(quantity(-25, 2))).toBe('-0.25');
    expect(formatQuantity(quantity(5, 3))).toBe('0.005');
  });

  it('can pad out to a wider display scale', () => {
    expect(formatQuantity(quantity(15, 1), { minScale: 4 })).toBe('1.5000');
  });

  it('ships the zero constants the rate book needs', () => {
    expect(formatQuantity(ZERO_RATE)).toBe('0.0000');
    expect(formatQuantity(ZERO_MILES)).toBe('0');
  });
});
