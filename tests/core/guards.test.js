import { describe, expect, it } from 'vitest';
import {
  frozen,
  optional,
  requireArray,
  requireInteger,
  requireObject,
  requireOneOf,
  requireString,
  requireUnique,
} from '../../src/core/guards.js';
import { ValidationError } from '../../src/core/errors.js';

describe('requireString', () => {
  it('passes a non blank string through', () => {
    expect(requireString('BNSF', 'mark')).toBe('BNSF');
  });

  it('rejects a non string', () => {
    expect(() => requireString(4, 'mark')).toThrow(ValidationError);
  });

  it('rejects blank by default', () => {
    expect(() => requireString('   ', 'mark')).toThrow(/must not be blank/);
  });

  it('allows blank when asked', () => {
    expect(requireString('', 'note', { allowEmpty: true })).toBe('');
  });
});

describe('requireInteger', () => {
  it('checks bounds', () => {
    expect(requireInteger(5, 'days', { min: 0, max: 10 })).toBe(5);
    expect(() => requireInteger(-1, 'days', { min: 0 })).toThrow(/at least 0/);
    expect(() => requireInteger(11, 'days', { max: 10 })).toThrow(/at most 10/);
  });

  it('rejects a float', () => {
    expect(() => requireInteger(1.5, 'days')).toThrow(ValidationError);
  });
});

describe('requireOneOf', () => {
  it('accepts a listed value', () => {
    expect(requireOneOf('actual', ['actual', 'constructive'], 'placement')).toBe('actual');
  });

  it('names the allowed set in the message', () => {
    expect(() => requireOneOf('held', ['actual', 'constructive'], 'placement')).toThrow(
      /actual, constructive/
    );
  });
});

describe('shape guards', () => {
  it('rejects arrays and null as objects', () => {
    expect(() => requireObject([], 'row')).toThrow(ValidationError);
    expect(() => requireObject(null, 'row')).toThrow(ValidationError);
    expect(requireObject({ a: 1 }, 'row')).toEqual({ a: 1 });
  });

  it('checks array length', () => {
    expect(() => requireArray([], 'legs', { minLength: 1 })).toThrow(/at least 1/);
    expect(requireArray([1], 'legs', { minLength: 1 })).toEqual([1]);
    expect(() => requireArray('no', 'legs')).toThrow(ValidationError);
  });
});

describe('optional', () => {
  it('skips undefined and null', () => {
    expect(optional(undefined, Number)).toBeUndefined();
    expect(optional(null, Number)).toBeUndefined();
  });

  it('applies otherwise', () => {
    expect(optional('7', Number)).toBe(7);
  });
});

describe('requireUnique', () => {
  it('passes distinct values', () => {
    expect(requireUnique(['a', 'b'], 'marks')).toEqual(['a', 'b']);
  });

  it('catches a duplicate by key', () => {
    const rows = [{ id: 1 }, { id: 1 }];
    expect(() => requireUnique(rows, 'rows', (row) => row.id)).toThrow(/duplicate/);
  });
});

describe('frozen', () => {
  it('freezes in place', () => {
    const value = frozen({ a: 1 });
    expect(Object.isFrozen(value)).toBe(true);
  });
});
