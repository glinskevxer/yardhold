import { describe, expect, it } from 'vitest';
import {
  OWNERSHIP,
  car,
  chargeBook,
  describeCar,
  isPrivateCar,
  isRailroadCar,
  netCapacityPounds,
} from '../../src/equipment/car.js';
import { ValidationError } from '../../src/core/errors.js';

const boxcar = () => car({ id: 'bnsf400123', designation: 'XM' });
const tank = () => car({ id: 'GATX 77', designation: 'T', ownerName: 'Delta Chemical' });

describe('building a car', () => {
  it('normalises the id and the designation', () => {
    const record = boxcar();
    expect(record.id).toBe('BNSF 400123');
    expect(record.mark).toBe('BNSF');
    expect(record.number).toBe(400123);
    expect(record.designation).toBe('XM');
    expect(record.kind).toBe('boxcar');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(boxcar())).toBe(true);
  });

  it('needs an id and a designation', () => {
    expect(() => car({ designation: 'XM' })).toThrow(ValidationError);
    expect(() => car({ id: 'BNSF 1' })).toThrow(ValidationError);
  });
});

describe('ownership', () => {
  it('reads it off the mark', () => {
    expect(boxcar().ownership).toBe(OWNERSHIP.RAILROAD);
    expect(tank().ownership).toBe(OWNERSHIP.PRIVATE);
  });

  it('records what the mark implied even when overridden', () => {
    const record = car({
      id: 'GATX 77',
      designation: 'T',
      ownership: OWNERSHIP.RAILROAD,
      ownershipReason: 'assigned to carrier service under the 2024 lease',
    });
    expect(record.ownership).toBe(OWNERSHIP.RAILROAD);
    expect(record.impliedOwnership).toBe(OWNERSHIP.PRIVATE);
  });

  it('refuses an override with no reason', () => {
    expect(() => car({ id: 'GATX 77', designation: 'T', ownership: OWNERSHIP.RAILROAD })).toThrow(
      /needs a reason/
    );
  });

  it('lets system cars through without a reason', () => {
    const record = car({ id: 'BNSF 1', designation: 'XM', ownership: OWNERSHIP.SYSTEM });
    expect(record.ownership).toBe(OWNERSHIP.SYSTEM);
  });

  it('refuses an ownership it does not know', () => {
    expect(() => car({ id: 'BNSF 1', designation: 'XM', ownership: 'leased' })).toThrow(
      ValidationError
    );
  });
});

describe('weights', () => {
  it('takes capacity and light weight', () => {
    const record = car({
      id: 'BNSF 1',
      designation: 'LO',
      capacityPounds: 220000,
      lightWeightPounds: 65000,
    });
    expect(netCapacityPounds(record)).toBe(155000);
  });

  it('is undefined when either weight is missing', () => {
    expect(netCapacityPounds(boxcar())).toBeUndefined();
  });

  it('refuses a light weight above the capacity', () => {
    expect(() =>
      car({ id: 'BNSF 1', designation: 'LO', capacityPounds: 60000, lightWeightPounds: 65000 })
    ).toThrow(/weigh more empty/);
  });

  it('refuses an impossible capacity', () => {
    expect(() => car({ id: 'BNSF 1', designation: 'LO', capacityPounds: 0 })).toThrow(
      ValidationError
    );
  });
});

describe('which book the car is billed under', () => {
  it('sends railroad cars to demurrage and private cars to storage', () => {
    expect(chargeBook(boxcar())).toBe('demurrage');
    expect(chargeBook(tank())).toBe('storage');
    expect(isRailroadCar(boxcar())).toBe(true);
    expect(isPrivateCar(tank())).toBe(true);
  });

  it('bills a system car under neither', () => {
    const record = car({ id: 'BNSF 1', designation: 'XM', ownership: OWNERSHIP.SYSTEM });
    expect(chargeBook(record)).toBe('none');
  });
});

describe('describeCar', () => {
  it('names the owner when there is one', () => {
    expect(describeCar(tank())).toBe('GATX 77 T Delta Chemical');
    expect(describeCar(boxcar())).toBe('BNSF 400123 XM');
  });
});
