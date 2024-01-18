import { describe, expect, it } from 'vitest';
import {
  abs,
  add,
  allocate,
  allocateByWeight,
  compare,
  formatMoney,
  fromCents,
  fromDollars,
  isZero,
  max,
  min,
  negate,
  parseMoney,
  scale,
  subtract,
  times,
} from '../../src/core/money.js';
import { ValidationError } from '../../src/core/errors.js';

describe('constructing money', () => {
  it('takes whole cents', () => {
    expect(fromCents(1250)).toBe(1250);
  });

  it('rejects fractional cents', () => {
    expect(() => fromCents(12.5)).toThrow(ValidationError);
  });

  it('rounds dollars to the nearest cent', () => {
    expect(fromDollars(12.345)).toBe(1235);
    expect(fromDollars(-3.005)).toBe(-300);
  });

  it('rejects a non finite dollar amount', () => {
    expect(() => fromDollars(Number.NaN)).toThrow(ValidationError);
    expect(() => fromDollars('4')).toThrow(ValidationError);
  });
});

describe('parseMoney', () => {
  it('reads plain decimals', () => {
    expect(parseMoney('120.50')).toBe(12050);
    expect(parseMoney('120')).toBe(12000);
    expect(parseMoney('120.5')).toBe(12050);
  });

  it('tolerates a dollar sign, commas and whitespace', () => {
    expect(parseMoney('  $1,275.25 ')).toBe(127525);
  });

  it('reads negatives', () => {
    expect(parseMoney('-45.10')).toBe(-4510);
  });

  it('refuses three decimal places', () => {
    expect(() => parseMoney('1.005')).toThrow(ValidationError);
  });

  it('refuses junk', () => {
    expect(() => parseMoney('one dollar')).toThrow(ValidationError);
    expect(() => parseMoney(120)).toThrow(ValidationError);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts', () => {
    expect(add(1000, 250, 5)).toBe(1255);
    expect(subtract(1000, 1250)).toBe(-250);
    expect(add()).toBe(0);
  });

  it('negates and takes magnitude', () => {
    expect(negate(500)).toBe(-500);
    expect(abs(-500)).toBe(500);
  });

  it('multiplies by a day count', () => {
    expect(times(7500, 4)).toBe(30000);
    expect(() => times(7500, 1.5)).toThrow(ValidationError);
  });
});

describe('scale', () => {
  it('prorates by a ratio', () => {
    expect(scale(10000, 1, 3)).toBe(3333);
    expect(scale(10000, 2, 3)).toBe(6667);
  });

  it('rounds half away from zero on both signs', () => {
    expect(scale(500, 1, 2)).toBe(250);
    expect(scale(501, 1, 2)).toBe(251);
    expect(scale(-501, 1, 2)).toBe(-251);
  });

  it('refuses a zero denominator', () => {
    expect(() => scale(100, 1, 0)).toThrow(ValidationError);
  });
});

describe('allocate', () => {
  it('sums back to the original', () => {
    const shares = allocate(10000, 3);
    expect(shares).toEqual([3334, 3333, 3333]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it('handles a single part', () => {
    expect(allocate(777, 1)).toEqual([777]);
  });

  it('keeps the sign on a negative amount', () => {
    const shares = allocate(-10, 4);
    expect(shares).toEqual([-3, -3, -2, -2]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(-10);
  });

  it('refuses a zero split', () => {
    expect(() => allocate(100, 0)).toThrow(ValidationError);
  });
});

describe('allocateByWeight', () => {
  it('splits in proportion and foots exactly', () => {
    const shares = allocateByWeight(10000, [1, 1, 2]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(shares[2]).toBe(5000);
  });

  it('gives the odd cent to the largest remainder', () => {
    expect(allocateByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('refuses weights that do not sum positive', () => {
    expect(() => allocateByWeight(100, [0, 0])).toThrow(ValidationError);
    expect(() => allocateByWeight(100, [])).toThrow(ValidationError);
  });
});

describe('comparison and formatting', () => {
  it('orders amounts', () => {
    expect(compare(100, 200)).toBe(-1);
    expect(compare(200, 100)).toBe(1);
    expect(compare(100, 100)).toBe(0);
  });

  it('spots zero', () => {
    expect(isZero(0)).toBe(true);
    expect(isZero(1)).toBe(false);
  });

  it('picks extremes', () => {
    expect(max(100, -50, 900)).toBe(900);
    expect(min(100, -50, 900)).toBe(-50);
  });

  it('formats with grouping', () => {
    expect(formatMoney(127525)).toBe('$1,275.25');
    expect(formatMoney(-4510)).toBe('-$45.10');
    expect(formatMoney(5)).toBe('$0.05');
  });

  it('can drop the grouping and the symbol', () => {
    expect(formatMoney(127525, { grouping: false, symbol: '' })).toBe('1275.25');
  });
});
