import { describe, expect, it } from 'vitest';
import {
  OVERLOAD_TOLERANCE_POUNDS,
  WEIGHING,
  billableWeight,
  isAdmissible,
  isOverloaded,
  latestAdmissible,
  overloadPounds,
  refusalReason,
  scaleTicket,
  ticketsForCar,
} from '../../src/equipment/scaleTicket.js';
import { ValidationError } from '../../src/core/errors.js';

const base = {
  number: 'ST-4411',
  carId: 'bnsf400123',
  weighedOn: '2024-03-05',
  grossPounds: 258000,
  tarePounds: 62000,
  scaleId: 'MEM-1',
  certificateExpiresOn: '2024-12-31',
};

const car = { capacityPounds: 200000 };

describe('scaleTicket', () => {
  it('normalises the car and works out the net', () => {
    const ticket = scaleTicket(base);
    expect(ticket.carId).toBe('BNSF 400123');
    expect(ticket.netPounds).toBe(196000);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(scaleTicket(base))).toBe(true);
  });

  it('refuses a tare at or above the gross', () => {
    expect(() => scaleTicket({ ...base, grossPounds: 62000 })).toThrow(/as much as the gross/);
    expect(() => scaleTicket({ ...base, grossPounds: 61000 })).toThrow(/as much as the gross/);
  });

  it('makes a track scale weight name the scale and the certificate', () => {
    expect(() => scaleTicket({ ...base, scaleId: undefined })).toThrow(/name the scale/);
    expect(() => scaleTicket({ ...base, certificateExpiresOn: undefined })).toThrow(/certificate/);
  });

  it('lets an agreed weight stand with neither', () => {
    const ticket = scaleTicket({
      ...base,
      method: WEIGHING.AGREED,
      scaleId: undefined,
      certificateExpiresOn: undefined,
    });
    expect(ticket.scaleId).toBeUndefined();
  });

  it('refuses a method it does not know', () => {
    expect(() => scaleTicket({ ...base, method: 'guessed' })).toThrow(ValidationError);
  });

  it('refuses an absurd weight', () => {
    expect(() => scaleTicket({ ...base, grossPounds: 900000 })).toThrow(ValidationError);
  });
});

describe('admissibility', () => {
  it('accepts a track scale weight inside its certificate', () => {
    expect(isAdmissible(scaleTicket(base))).toBe(true);
    expect(refusalReason(scaleTicket(base))).toBeUndefined();
  });

  it('refuses one weighed after the certificate lapsed', () => {
    const stale = scaleTicket({ ...base, certificateExpiresOn: '2024-03-04' });
    expect(isAdmissible(stale)).toBe(false);
    expect(refusalReason(stale)).toMatch(/out of certificate/);
  });

  it('accepts a weight taken on the day the certificate expires', () => {
    expect(isAdmissible(scaleTicket({ ...base, certificateExpiresOn: '2024-03-05' }))).toBe(true);
  });

  it('accepts an agreed weight without any certificate', () => {
    const agreed = scaleTicket({
      ...base,
      method: WEIGHING.AGREED,
      scaleId: undefined,
      certificateExpiresOn: undefined,
    });
    expect(isAdmissible(agreed)).toBe(true);
  });

  it('never accepts an estimate', () => {
    const estimated = scaleTicket({
      ...base,
      method: WEIGHING.ESTIMATED,
      scaleId: undefined,
      certificateExpiresOn: undefined,
    });
    expect(isAdmissible(estimated)).toBe(false);
    expect(refusalReason(estimated)).toMatch(/not a weight/);
  });
});

describe('overload', () => {
  it('allows the tolerance', () => {
    expect(OVERLOAD_TOLERANCE_POUNDS).toBe(2000);
    expect(overloadPounds(scaleTicket({ ...base, grossPounds: 264000 }), car)).toBe(0);
    expect(isOverloaded(scaleTicket({ ...base, grossPounds: 264000 }), car)).toBe(false);
  });

  it('reports the whole excess once it is over', () => {
    const heavy = scaleTicket({ ...base, grossPounds: 270000 });
    expect(overloadPounds(heavy, car)).toBe(8000);
    expect(isOverloaded(heavy, car)).toBe(true);
  });

  it('takes a tolerance of its own', () => {
    const heavy = scaleTicket({ ...base, grossPounds: 264000 });
    expect(overloadPounds(heavy, car, { tolerance: 0 })).toBe(2000);
  });

  it('reports nothing when the capacity is unknown', () => {
    expect(overloadPounds(scaleTicket(base), {})).toBe(0);
    expect(overloadPounds(scaleTicket(base), undefined)).toBe(0);
  });
});

describe('billableWeight', () => {
  it('caps at the capacity', () => {
    expect(billableWeight(scaleTicket({ ...base, grossPounds: 270000 }), car)).toBe(200000);
  });

  it('bills the net when it is under capacity', () => {
    expect(billableWeight(scaleTicket(base), car)).toBe(196000);
  });

  it('honours a tariff minimum', () => {
    expect(billableWeight(scaleTicket(base), car, { minimumPounds: 198000 })).toBe(198000);
  });

  it('is nothing at all for an inadmissible ticket', () => {
    const stale = scaleTicket({ ...base, certificateExpiresOn: '2024-03-04' });
    expect(billableWeight(stale, car)).toBeUndefined();
  });

  it('bills the net when nothing is known about the car', () => {
    expect(billableWeight(scaleTicket(base))).toBe(196000);
  });
});

describe('working with a set', () => {
  const tickets = [
    scaleTicket({ ...base, number: 'ST-2', weighedOn: '2024-03-09' }),
    scaleTicket(base),
    scaleTicket({
      ...base,
      number: 'ST-3',
      weighedOn: '2024-03-12',
      certificateExpiresOn: '2024-03-10',
    }),
    scaleTicket({ ...base, number: 'ST-9', carId: 'GATX 77' }),
  ];

  it('finds a car in date order', () => {
    expect(ticketsForCar(tickets, 'bnsf400123').map((ticket) => ticket.number)).toEqual([
      'ST-4411',
      'ST-2',
      'ST-3',
    ]);
  });

  it('takes the latest admissible one rather than the latest', () => {
    expect(latestAdmissible(tickets, 'BNSF 400123').number).toBe('ST-2');
  });

  it('has nothing for a car with no admissible ticket', () => {
    const estimated = [
      scaleTicket({
        ...base,
        method: WEIGHING.ESTIMATED,
        scaleId: undefined,
        certificateExpiresOn: undefined,
      }),
    ];
    expect(latestAdmissible(estimated, 'BNSF 400123')).toBeUndefined();
  });
});
