import { describe, expect, it } from 'vitest';
import { keyedBook } from '../../src/core/keyedBook.js';
import { ConflictError, NotFoundError, ValidationError } from '../../src/core/errors.js';

const book = (records, extra = {}) =>
  keyedBook({ label: 'widget', records, keyOf: (record) => record.id, ...extra });

describe('keyedBook', () => {
  it('indexes what it was given', () => {
    const register = book([{ id: 'B' }, { id: 'A' }]);
    expect(register.size).toBe(2);
    expect(register.keys()).toEqual(['A', 'B']);
  });

  it('returns records in key order', () => {
    const register = book([
      { id: 'B', n: 2 },
      { id: 'A', n: 1 },
    ]);
    expect(register.all().map((record) => record.n)).toEqual([1, 2]);
  });

  it('has, finds and gets', () => {
    const register = book([{ id: 'A' }]);
    expect(register.has('A')).toBe(true);
    expect(register.find('A')).toEqual({ id: 'A' });
    expect(register.find('Z')).toBeUndefined();
    expect(register.get('A')).toEqual({ id: 'A' });
  });

  it('names itself in the miss', () => {
    try {
      book([]).get('Z');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.what).toBe('widget');
    }
  });

  it('refuses a duplicate key', () => {
    expect(() => book([{ id: 'A' }, { id: 'A' }])).toThrow(ConflictError);
  });

  it('can be told to let a duplicate overwrite', () => {
    const register = book(
      [
        { id: 'A', n: 1 },
        { id: 'A', n: 2 },
      ],
      { onDuplicate: 'replace' }
    );
    expect(register.size).toBe(1);
    expect(register.get('A').n).toBe(2);
  });

  it('builds each record through the builder it was given', () => {
    const register = keyedBook({
      label: 'widget',
      records: ['a'],
      keyOf: (record) => record.id,
      build: (raw) => (typeof raw === 'string' ? { id: raw.toUpperCase() } : raw),
    });
    expect(register.get('A')).toEqual({ id: 'A' });
  });

  it('normalises the lookup key', () => {
    const register = keyedBook({
      label: 'widget',
      records: [{ id: 'A' }],
      keyOf: (record) => record.id,
      normalizeKey: (key) => String(key).trim().toUpperCase(),
    });
    expect(register.has(' a ')).toBe(true);
  });

  it('filters', () => {
    const register = book([
      { id: 'A', n: 1 },
      { id: 'B', n: 2 },
    ]);
    expect(register.filter((record) => record.n > 1)).toEqual([{ id: 'B', n: 2 }]);
  });

  it('adds after construction', () => {
    const register = book([]);
    register.add({ id: 'A' });
    expect(register.size).toBe(1);
  });

  it('replaces only what is already there', () => {
    const register = book([{ id: 'A', n: 1 }]);
    expect(register.replace({ id: 'A', n: 9 }).n).toBe(9);
    expect(() => register.replace({ id: 'Z' })).toThrow(NotFoundError);
  });

  it('refuses a non array of records', () => {
    expect(() => book('nope')).toThrow(ValidationError);
  });

  it('refuses a key that is not a string by default', () => {
    expect(() => book([{ id: 'A' }]).has(4)).toThrow(ValidationError);
  });
});
