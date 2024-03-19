import { describe, expect, it } from 'vitest';
import {
  carKind,
  carType,
  describeCarType,
  designationsOfKind,
  isCovered,
  isMultipleSpot,
  knownDesignations,
  mechanicalDesignation,
  tryCarType,
} from '../../src/equipment/carType.js';
import { NotFoundError, ValidationError } from '../../src/core/errors.js';

describe('mechanicalDesignation', () => {
  it('uppercases and trims', () => {
    expect(mechanicalDesignation(' lo ')).toBe('LO');
  });

  it('refuses digits and long codes', () => {
    expect(() => mechanicalDesignation('L1')).toThrow(ValidationError);
    expect(() => mechanicalDesignation('LONGER')).toThrow(ValidationError);
  });
});

describe('carType', () => {
  it('reads a known designation', () => {
    expect(carType('LO')).toEqual({
      designation: 'LO',
      kind: 'hopper',
      name: 'covered hopper',
      doors: 0,
      covered: true,
    });
  });

  it('throws for an unlisted designation', () => {
    expect(() => carType('ZZ')).toThrow(NotFoundError);
  });

  it('has a soft lookup', () => {
    expect(tryCarType('ZZ')).toBeUndefined();
    expect(tryCarType('XM').kind).toBe('boxcar');
  });

  it('still validates the shape in the soft lookup', () => {
    expect(() => tryCarType('X1')).toThrow(ValidationError);
  });
});

describe('the properties the tariff keys off', () => {
  it('names the kind', () => {
    expect(carKind('T')).toBe('tank');
    expect(carKind('GB')).toBe('gondola');
  });

  it('knows which cars are covered', () => {
    expect(isCovered('LO')).toBe(true);
    expect(isCovered('HT')).toBe(false);
  });

  it('knows which cars can hold two spots', () => {
    expect(isMultipleSpot('XM')).toBe(true);
    expect(isMultipleSpot('LO')).toBe(false);
  });
});

describe('the catalogue', () => {
  it('lists the designations in order', () => {
    const known = knownDesignations();
    expect(known).toContain('XM');
    expect(known).toEqual([...known].sort());
    expect(known.length).toBeGreaterThan(10);
  });

  it('groups by kind', () => {
    expect(designationsOfKind('boxcar')).toEqual(['XL', 'XM', 'XP']);
    expect(designationsOfKind('refrigerated')).toEqual(['RB', 'RP']);
    expect(designationsOfKind('nothing')).toEqual([]);
  });

  it('describes a car for a statement line', () => {
    expect(describeCarType('FB')).toBe('FB bulkhead flatcar');
  });
});
