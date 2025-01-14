import { describe, expect, it } from 'vitest';
import {
  MOVEMENT,
  commodityClassFor,
  isInbound,
  serviceFor,
  waybill,
  waybillBook,
} from '../../src/events/waybill.js';
import { STANDARD_COMMODITIES, commodityBook } from '../../src/tariff/commodity.js';
import { ValidationError } from '../../src/core/errors.js';

const base = {
  number: 'WB-99012',
  carId: 'bnsf400123',
  movement: MOVEMENT.INBOUND_LOADED,
  billedOn: '2024-03-01',
  commodityCode: '0113210',
  netWeightPounds: 190000,
  consigneeId: 'delta',
};

describe('waybill', () => {
  it('normalises the car, the commodity and the consignee', () => {
    const record = waybill(base);
    expect(record.carId).toBe('BNSF 400123');
    expect(record.commodityCode).toBe('0113210');
    expect(record.consigneeId).toBe('DELTA');
  });

  it('works out whether it is loaded', () => {
    expect(waybill(base).loaded).toBe(true);
    const empty = waybill({
      ...base,
      movement: MOVEMENT.OUTBOUND_EMPTY,
      commodityCode: undefined,
      netWeightPounds: undefined,
    });
    expect(empty.loaded).toBe(false);
  });

  it('makes a loaded waybill name a commodity and a weight', () => {
    expect(() => waybill({ ...base, commodityCode: undefined })).toThrow(/name a commodity/);
    expect(() => waybill({ ...base, netWeightPounds: undefined })).toThrow(/carry a weight/);
  });

  it('refuses a commodity on an empty movement', () => {
    expect(() =>
      waybill({ ...base, movement: MOVEMENT.INBOUND_EMPTY, netWeightPounds: undefined })
    ).toThrow(/cannot carry a commodity/);
  });

  it('refuses a movement it does not know', () => {
    expect(() => waybill({ ...base, movement: 'sideways' })).toThrow(ValidationError);
  });

  it('refuses an absurd weight', () => {
    expect(() => waybill({ ...base, netWeightPounds: 900000 })).toThrow(ValidationError);
  });

  it('uppercases and freezes the route', () => {
    const record = waybill({ ...base, route: ['bnsf', 'up'] });
    expect(record.route).toEqual(['BNSF', 'UP']);
    expect(Object.isFrozen(record.route)).toBe(true);
  });

  it('needs a number and a date', () => {
    expect(() => waybill({ ...base, number: undefined })).toThrow(ValidationError);
    expect(() => waybill({ ...base, billedOn: undefined })).toThrow(ValidationError);
  });
});

describe('direction', () => {
  it('reads inbound off the movement', () => {
    expect(isInbound(waybill(base))).toBe(true);
    const out = waybill({ ...base, movement: MOVEMENT.OUTBOUND_LOADED });
    expect(isInbound(out)).toBe(false);
  });

  it('turns direction into the service the tariff keys on', () => {
    expect(serviceFor(waybill(base))).toBe('unloading');
    expect(serviceFor(waybill({ ...base, movement: MOVEMENT.OUTBOUND_LOADED }))).toBe('loading');
  });
});

describe('waybillBook', () => {
  const book = waybillBook([
    base,
    {
      ...base,
      number: 'WB-99013',
      billedOn: '2024-03-15',
      commodityCode: '3241110',
    },
    {
      ...base,
      number: 'WB-99014',
      carId: 'GATX 77',
      commodityCode: '2818142',
      billedOn: '2024-03-10',
    },
  ]);

  it('counts and lists the cars', () => {
    expect(book.size).toBe(3);
    expect(book.cars()).toEqual(['BNSF 400123', 'GATX 77']);
  });

  it('keeps the waybills for a car in date order', () => {
    expect(book.forCar('bnsf400123').map((record) => record.number)).toEqual([
      'WB-99012',
      'WB-99013',
    ]);
  });

  it('finds the waybill in force on a day', () => {
    expect(book.onDate('BNSF 400123', '2024-03-14').number).toBe('WB-99012');
    expect(book.onDate('BNSF 400123', '2024-03-15').number).toBe('WB-99013');
  });

  it('has nothing before the first waybill', () => {
    expect(book.onDate('BNSF 400123', '2024-02-28')).toBeUndefined();
  });

  it('has nothing for a car it does not hold', () => {
    expect(book.forCar('UP 1')).toEqual([]);
    expect(book.onDate('UP 1', '2024-03-14')).toBeUndefined();
  });

  it('refuses a non array', () => {
    expect(() => waybillBook('nope')).toThrow(ValidationError);
  });
});

describe('commodityClassFor', () => {
  const commodities = commodityBook(STANDARD_COMMODITIES);
  const book = waybillBook([
    base,
    { ...base, number: 'WB-2', billedOn: '2024-03-15', commodityCode: '3241110' },
  ]);

  it('reads the class through the waybill in force', () => {
    expect(commodityClassFor(book, commodities, 'BNSF 400123', '2024-03-05')).toBe('GRAIN');
    expect(commodityClassFor(book, commodities, 'BNSF 400123', '2024-03-20')).toBe('CEMENT');
  });

  it('is nothing when there is no waybill', () => {
    expect(commodityClassFor(book, commodities, 'BNSF 400123', '2024-02-01')).toBeUndefined();
    expect(commodityClassFor(book, commodities, 'UP 1', '2024-03-05')).toBeUndefined();
  });

  it('is nothing for an empty movement', () => {
    const empties = waybillBook([
      {
        ...base,
        number: 'WB-3',
        movement: MOVEMENT.INBOUND_EMPTY,
        commodityCode: undefined,
        netWeightPounds: undefined,
      },
    ]);
    expect(commodityClassFor(empties, commodities, 'BNSF 400123', '2024-03-05')).toBeUndefined();
  });
});
