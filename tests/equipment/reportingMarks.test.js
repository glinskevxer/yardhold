import { describe, expect, it } from 'vitest';
import {
  carInitialAndNumber,
  carNumber,
  checkDigit,
  compareCarIds,
  formatCarId,
  isPrivateMark,
  isRailroadMark,
  normalizeCarId,
  reportingMark,
  sameCar,
} from '../../src/equipment/reportingMarks.js';
import { ValidationError } from '../../src/core/errors.js';

describe('reportingMark', () => {
  it('uppercases and trims', () => {
    expect(reportingMark('  bnsf ')).toBe('BNSF');
  });

  it('takes two to four letters', () => {
    expect(reportingMark('UP')).toBe('UP');
    expect(() => reportingMark('U')).toThrow(ValidationError);
    expect(() => reportingMark('TOOLONG')).toThrow(ValidationError);
  });

  it('refuses digits inside a mark', () => {
    expect(() => reportingMark('UP1')).toThrow(ValidationError);
  });
});

describe('private and railroad marks', () => {
  it('reads the trailing X as private ownership', () => {
    expect(isPrivateMark('GATX')).toBe(true);
    expect(isPrivateMark('TILX')).toBe(true);
    expect(isRailroadMark('BNSF')).toBe(true);
    expect(isRailroadMark('UP')).toBe(true);
  });

  it('is case insensitive about it', () => {
    expect(isPrivateMark('gatx')).toBe(true);
  });
});

describe('carNumber', () => {
  it('reads digits from text', () => {
    expect(carNumber(' 400123 ')).toBe(400123);
  });

  it('refuses zero, seven digits and fractions', () => {
    expect(() => carNumber(0)).toThrow(ValidationError);
    expect(() => carNumber(1000000)).toThrow(ValidationError);
    expect(() => carNumber(12.5)).toThrow(ValidationError);
  });
});

describe('car ids', () => {
  it('splits the written forms', () => {
    expect(carInitialAndNumber('BNSF 400123')).toEqual({ mark: 'BNSF', number: 400123 });
    expect(carInitialAndNumber('bnsf400123')).toEqual({ mark: 'BNSF', number: 400123 });
    expect(carInitialAndNumber(' GATX-77 ')).toEqual({ mark: 'GATX', number: 77 });
  });

  it('refuses a car id with no number', () => {
    expect(() => carInitialAndNumber('BNSF')).toThrow(ValidationError);
  });

  it('normalises to one written form', () => {
    expect(normalizeCarId('bnsf400123')).toBe('BNSF 400123');
    expect(formatCarId({ mark: 'up', number: '12' })).toBe('UP 12');
  });

  it('compares two ids for the same car', () => {
    expect(sameCar('BNSF 400123', 'bnsf-400123')).toBe(true);
    expect(sameCar('BNSF 400123', 'BNSF 400124')).toBe(false);
  });
});

describe('checkDigit', () => {
  it('is a single digit', () => {
    expect(checkDigit('BNSF 400123')).toBeGreaterThanOrEqual(0);
    expect(checkDigit('BNSF 400123')).toBeLessThanOrEqual(9);
  });

  it('is stable for the same car', () => {
    expect(checkDigit('BNSF 400123')).toBe(checkDigit('bnsf400123'));
  });

  it('changes when the number changes', () => {
    expect(checkDigit('BNSF 400123')).not.toBe(checkDigit('BNSF 400124'));
  });
});

describe('ordering', () => {
  it('sorts by mark then number', () => {
    const ids = ['UP 20', 'BNSF 400123', 'UP 3', 'GATX 77'];
    expect([...ids].sort(compareCarIds)).toEqual(['BNSF 400123', 'GATX 77', 'UP 3', 'UP 20']);
  });
});
