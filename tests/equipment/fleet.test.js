import { describe, expect, it } from 'vitest';
import { fleet, fleetSummary } from '../../src/equipment/fleet.js';
import { car } from '../../src/equipment/car.js';
import { ConflictError, NotFoundError } from '../../src/core/errors.js';

const seed = () =>
  fleet([
    { id: 'BNSF 400123', designation: 'XM' },
    { id: 'UP 20', designation: 'LO' },
    { id: 'GATX 77', designation: 'T', ownerName: 'Delta Chemical' },
    { id: 'UP 3', designation: 'LO' },
  ]);

describe('registering', () => {
  it('takes plain records and builds them', () => {
    const register = seed();
    expect(register.size).toBe(4);
    expect(register.get('bnsf400123').kind).toBe('boxcar');
  });

  it('takes an already built car', () => {
    const register = fleet();
    const built = car({ id: 'UP 1', designation: 'XM' });
    expect(register.add(built)).toBe(built);
  });

  it('refuses a duplicate', () => {
    const register = seed();
    expect(() => register.add({ id: 'up-20', designation: 'LO' })).toThrow(ConflictError);
  });

  it('upserts either way', () => {
    const register = seed();
    register.upsert({ id: 'UP 20', designation: 'LO', ownerName: 'Grain Co' });
    expect(register.get('UP 20').ownerName).toBe('Grain Co');
    register.upsert({ id: 'UP 99', designation: 'HT' });
    expect(register.size).toBe(5);
  });

  it('refuses to replace a car that is not registered', () => {
    expect(() => fleet().replace({ id: 'UP 1', designation: 'XM' })).toThrow(NotFoundError);
  });
});

describe('history', () => {
  it('keeps every version of a record', () => {
    const register = seed();
    register.replace({ id: 'UP 20', designation: 'LO', ownerName: 'Grain Co' });
    register.replace({ id: 'UP 20', designation: 'LO', ownerName: 'Grain Co II' });
    const versions = register.versionsOf('UP 20');
    expect(versions).toHaveLength(3);
    expect(versions[0].ownerName).toBeUndefined();
    expect(versions[2].ownerName).toBe('Grain Co II');
  });

  it('is empty for an unknown car', () => {
    expect(seed().versionsOf('UP 999')).toEqual([]);
  });
});

describe('lookup', () => {
  it('normalises the key', () => {
    const register = seed();
    expect(register.has('gatx-77')).toBe(true);
    expect(register.find('gatx 77').ownerName).toBe('Delta Chemical');
  });

  it('throws on a miss but find returns undefined', () => {
    const register = seed();
    expect(() => register.get('UP 999')).toThrow(NotFoundError);
    expect(register.find('UP 999')).toBeUndefined();
  });

  it('lists ids in car order', () => {
    expect(seed().ids()).toEqual(['BNSF 400123', 'GATX 77', 'UP 3', 'UP 20']);
  });
});

describe('slicing the fleet', () => {
  it('filters by kind and mark', () => {
    const register = seed();
    expect(register.ofKind('hopper').map((record) => record.id)).toEqual(['UP 3', 'UP 20']);
    expect(register.ofMark('gatx')).toHaveLength(1);
  });

  it('separates railroad from private', () => {
    const register = seed();
    expect(register.railroadCars()).toHaveLength(3);
    expect(register.privateCars()).toHaveLength(1);
  });

  it('takes an arbitrary predicate', () => {
    const register = seed();
    expect(register.filter((record) => record.number > 50)).toHaveLength(2);
  });
});

describe('fleetSummary', () => {
  it('counts by ownership and kind', () => {
    expect(fleetSummary(seed())).toEqual({
      total: 4,
      railroad: 3,
      private: 1,
      byKind: { boxcar: 1, hopper: 2, tank: 1 },
    });
  });

  it('handles an empty register', () => {
    expect(fleetSummary(fleet())).toEqual({ total: 0, railroad: 0, private: 0, byKind: {} });
  });
});
