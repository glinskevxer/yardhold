import { describe, expect, it } from 'vitest';
import { rateBook } from '../../src/core/rateBook.js';
import { NotFoundError, ValidationError } from '../../src/core/errors.js';

const book = (rates, extra = {}) =>
  rateBook({ label: 'widget rate', rates, keyOf: (entry) => entry.kind, ...extra });

describe('rateBook', () => {
  it('indexes by the key it was given', () => {
    const register = book([
      { kind: 'b', rate: 2 },
      { kind: 'a', rate: 1 },
    ]);
    expect(register.size).toBe(2);
    expect(register.keys()).toEqual(['a', 'b']);
  });

  it('finds and returns undefined on a miss', () => {
    const register = book([{ kind: 'a', rate: 1 }]);
    expect(register.find('a').rate).toBe(1);
    expect(register.find('z')).toBeUndefined();
  });

  it('throws on a miss when asked to insist', () => {
    try {
      book([]).rateFor('z');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.what).toBe('widget rate');
    }
  });

  it('lets a later entry replace an earlier one', () => {
    const register = book([
      { kind: 'a', rate: 1 },
      { kind: 'a', rate: 9 },
    ]);
    expect(register.size).toBe(1);
    expect(register.find('a').rate).toBe(9);
  });

  it('builds each entry through the builder', () => {
    const register = rateBook({
      label: 'widget rate',
      rates: ['a'],
      keyOf: (entry) => entry.kind,
      build: (raw) => (typeof raw === 'string' ? { kind: raw, rate: 0 } : raw),
    });
    expect(register.find('a').rate).toBe(0);
  });

  it('lists the entries in key order', () => {
    const register = book([
      { kind: 'b', rate: 2 },
      { kind: 'a', rate: 1 },
    ]);
    expect(register.all().map((entry) => entry.rate)).toEqual([1, 2]);
  });

  it('is empty when given nothing', () => {
    expect(rateBook({ label: 'x', keyOf: (entry) => entry.kind }).size).toBe(0);
  });

  it('refuses a non array', () => {
    expect(() => book('nope')).toThrow(ValidationError);
  });
});
