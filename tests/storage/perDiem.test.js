import { describe, expect, it } from 'vitest';
import {
  HIRE_BASIS,
  describeHire,
  hireBook,
  hireCharge,
  hireRate,
  prorateHire,
} from '../../src/storage/perDiem.js';
import { quantity } from '../../src/core/quantity.js';
import { ValidationError } from '../../src/core/errors.js';

const timeMileage = hireRate({
  carKind: 'boxcar',
  hourlyRate: '0.7500',
  mileageRate: '0.0425',
  freeRunningHours: 24,
});

const straight = hireRate({
  carKind: 'tank',
  basis: HIRE_BASIS.STRAIGHT,
  dailyRate: '32.00',
});

describe('hireRate', () => {
  it('parses the rates at four places', () => {
    expect(timeMileage.hourlyRate).toEqual(quantity(7500, 4));
    expect(timeMileage.mileageRate).toEqual(quantity(425, 4));
  });

  it('needs a car kind', () => {
    expect(() => hireRate({})).toThrow(ValidationError);
  });

  it('refuses negative rates', () => {
    expect(() => hireRate({ carKind: 'boxcar', hourlyRate: '-1.0000' })).toThrow(
      /cannot be negative/
    );
  });

  it('makes a straight rate carry a daily figure', () => {
    expect(() => hireRate({ carKind: 'tank', basis: HIRE_BASIS.STRAIGHT })).toThrow(
      /needs a daily rate/
    );
  });

  it('refuses a basis it does not know', () => {
    expect(() => hireRate({ carKind: 'tank', basis: 'weekly' })).toThrow(ValidationError);
  });

  it('refuses free running hours beyond ten days', () => {
    expect(() => hireRate({ carKind: 'boxcar', freeRunningHours: 300 })).toThrow(ValidationError);
  });
});

describe('the straight basis', () => {
  it('charges whole days', () => {
    const charge = hireCharge(straight, { days: 3 });
    expect(charge.total).toBe(9600);
    expect(charge.mileageCharge).toBe(0);
  });

  it('rounds an odd stretch of hours up to a day', () => {
    expect(hireCharge(straight, { hours: 25 }).total).toBe(6400);
  });

  it('ignores mileage entirely', () => {
    expect(hireCharge(straight, { days: 1, loadedMiles: 900 }).mileageCharge).toBe(0);
  });

  it('charges nothing for no time', () => {
    expect(hireCharge(straight, { days: 0 }).total).toBe(0);
  });
});

describe('the time and mileage basis', () => {
  it('waives the free running hours', () => {
    expect(hireCharge(timeMileage, { hours: 24 }).chargedHours).toBe(0);
    expect(hireCharge(timeMileage, { hours: 30 }).chargedHours).toBe(6);
  });

  it('charges the hourly rate on what is left', () => {
    expect(hireCharge(timeMileage, { hours: 30 }).timeCharge).toBe(450);
  });

  it('charges the mileage separately', () => {
    expect(hireCharge(timeMileage, { hours: 24, loadedMiles: 200 }).mileageCharge).toBe(850);
  });

  it('adds the two halves', () => {
    const charge = hireCharge(timeMileage, { hours: 30, loadedMiles: 200 });
    expect(charge.total).toBe(1300);
  });

  it('takes a quantity of miles as well as a number', () => {
    expect(hireCharge(timeMileage, { loadedMiles: quantity(200, 0) }).mileageCharge).toBe(850);
  });

  it('makes a car that ran cost more than one that sat the same time', () => {
    const sat = hireCharge(timeMileage, { hours: 48 });
    const ran = hireCharge(timeMileage, { hours: 48, loadedMiles: 400 });
    expect(ran.total).toBeGreaterThan(sat.total);
  });

  it('refuses negative hours', () => {
    expect(() => hireCharge(timeMileage, { hours: -1 })).toThrow(ValidationError);
  });
});

describe('hireBook', () => {
  const book = hireBook([timeMileage, straight, { carKind: 'hopper', hourlyRate: '0.6000' }]);

  it('indexes by car kind', () => {
    expect(book.size).toBe(3);
    expect(book.find('boxcar').basis).toBe(HIRE_BASIS.TIME_MILEAGE);
    expect(book.find('nothing')).toBeUndefined();
  });

  it('lists the kinds in order', () => {
    expect(book.kinds()).toEqual(['boxcar', 'hopper', 'tank']);
  });

  it('lets a later entry replace an earlier one', () => {
    const replaced = hireBook([timeMileage, { carKind: 'boxcar', hourlyRate: '1.0000' }]);
    expect(replaced.size).toBe(1);
    expect(replaced.find('boxcar').hourlyRate.units).toBe(10000);
  });
});

describe('prorateHire', () => {
  it('splits a charge by a ratio', () => {
    const charge = hireCharge(timeMileage, { hours: 30, loadedMiles: 200 });
    expect(prorateHire(charge, 1, 2)).toBe(650);
  });
});

describe('describeHire', () => {
  it('names the two halves', () => {
    const charge = hireCharge(timeMileage, { hours: 30, loadedMiles: 200 });
    expect(describeHire(charge)).toBe('time-mileage time 450 mileage 850');
  });
});
