import { describe, expect, it } from 'vitest';
import { car } from '../src/equipment/car.js';
import { fleet } from '../src/equipment/fleet.js';
import { station, stationBook } from '../src/site/station.js';
import { track, trackBook } from '../src/site/track.js';
import { party, partyBook } from '../src/site/party.js';
import { tariff } from '../src/tariff/tariff.js';
import { tariffBook } from '../src/tariff/tariffBook.js';
import { SERVICE } from '../src/tariff/freeTimeTable.js';
import { commodity, commodityBook } from '../src/tariff/commodity.js';
import { waybill, waybillBook } from '../src/events/waybill.js';
import { exclusion, EVIDENCE, EXCLUSION } from '../src/exclusions/exclusion.js';
import { exclusionRegistry } from '../src/exclusions/registry.js';
import { hireBook, hireRate } from '../src/storage/perDiem.js';
import { serviceBook, serviceRate, SERVICE_KIND } from '../src/storage/ancillary.js';
import { switchRate, switchTariff } from '../src/switching/switchCharge.js';
import { SWITCH_KIND } from '../src/switching/switchOrder.js';
import { carOrder, orderSchedule } from '../src/bunching/orderSchedule.js';

/**
 * Every register takes either a raw record or one already built, and each one
 * decides which it was given by looking at the record. Those tests were spread
 * across a dozen files and none of them checked the other direction, which is
 * how a frozen literal got waved through as a built tariff page and blew up
 * four calls later inside the rate ladder.
 *
 * This is the pair of checks, for every register, in one place.
 */

const rawPage = {
  id: 'DEM-4000',
  carrier: 'BNSF',
  ladder: [{ fromDay: 1, rate: '150.00' }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
};

const rawWaybill = {
  number: 'WB-1',
  carId: 'BNSF 400123',
  movement: 'inbound-loaded',
  billedOn: '2024-03-01',
  commodityCode: '0113210',
  netWeightPounds: 190000,
};

const rawExclusion = {
  kind: EXCLUSION.WEATHER,
  from: '2024-03-07T06:00',
  to: '2024-03-08T18:00',
  splc: '412300',
  evidence: EVIDENCE.CARRIER_BULLETIN,
};

const registers = [
  {
    name: 'fleet',
    raw: { id: 'BNSF 400123', designation: 'XM' },
    build: car,
    make: (records) => fleet(records),
    size: (register) => register.size,
    check: (register) => expect(register.get('BNSF 400123').kind).toBe('boxcar'),
  },
  {
    name: 'stationBook',
    raw: { splc: '412300', name: 'Memphis North', carrier: 'BNSF' },
    build: station,
    make: (records) => stationBook(records),
    size: (register) => register.size,
    check: (register) => expect(register.find('412300').calendarId).toBeDefined(),
  },
  {
    name: 'trackBook',
    raw: { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
    build: track,
    make: (records) => trackBook(records),
    size: (register) => register.size,
    check: (register) => expect(register.get('IT-9').spots).toEqual([]),
  },
  {
    name: 'partyBook',
    raw: { id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'a@b.example' },
    build: party,
    make: (records) => partyBook(records),
    size: (register) => register.size,
    check: (register) => expect(register.get('DELTA').responsibleFor).toEqual([]),
  },
  {
    name: 'commodityBook',
    raw: { code: '0113210', name: 'corn', commodityClass: 'GRAIN' },
    build: commodity,
    make: (records) => commodityBook(records),
    size: (register) => register.size,
    check: (register) => expect(register.classOf('0113210')).toBe('GRAIN'),
  },
  {
    name: 'waybillBook',
    raw: rawWaybill,
    build: waybill,
    make: (records) => waybillBook(records),
    size: (register) => register.size,
    check: (register) => expect(register.forCar('BNSF 400123')[0].loaded).toBe(true),
  },
  {
    name: 'exclusionRegistry',
    raw: rawExclusion,
    build: exclusion,
    make: (records) => exclusionRegistry(records),
    size: (register) => register.size,
    check: (register) => expect(register.all()[0].span).toBeDefined(),
  },
  {
    name: 'hireBook',
    raw: { carKind: 'boxcar', hourlyRate: '0.7500' },
    build: hireRate,
    make: (records) => hireBook(records),
    size: (register) => register.size,
    check: (register) => expect(register.find('boxcar').hourlyRate.units).toBe(7500),
  },
  {
    name: 'serviceBook',
    raw: { kind: SERVICE_KIND.WEIGHING, rate: '95.00' },
    build: serviceRate,
    make: (records) => serviceBook(records),
    size: (register) => register.size,
    check: (register) => expect(register.find(SERVICE_KIND.WEIGHING).rate).toBe(9500),
  },
  {
    name: 'switchTariff',
    raw: { kind: SWITCH_KIND.INTRA_PLANT, rate: '340.00' },
    build: switchRate,
    make: (records) => switchTariff(records),
    size: (register) => register.size,
    check: (register) => expect(register.find(SWITCH_KIND.INTRA_PLANT).rate).toBe(34000),
  },
  {
    name: 'orderSchedule',
    raw: { consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-04', cars: 2 },
    build: carOrder,
    make: (records) => orderSchedule(records),
    size: (register) => register.size,
    check: (register) => expect(register.carsOrderedOn('DELTA', '2024-03-04')).toBe(2),
  },
];

describe.each(registers)('$name', ({ raw, build, make, size, check }) => {
  it('builds a raw record', () => {
    const register = make([raw]);
    expect(size(register)).toBe(1);
    check(register);
  });

  it('takes one that is already built', () => {
    const register = make([build(raw)]);
    expect(size(register)).toBe(1);
    check(register);
  });

  it('gives the same answer either way', () => {
    const fromRaw = make([raw]);
    const fromBuilt = make([build(raw)]);
    expect(size(fromRaw)).toBe(size(fromBuilt));
  });

  it('is empty when given nothing', () => {
    expect(size(make([]))).toBe(0);
  });
});

describe('tariffBook', () => {
  const filing = { page: rawPage, effectiveFrom: '2024-01-01' };

  it('builds a raw page', () => {
    const book = tariffBook([filing]);
    expect(book.resolve({ carrier: 'BNSF', on: '2024-03-01' }).id).toBe('DEM-4000');
  });

  it('takes a page that is already built', () => {
    const book = tariffBook([{ page: tariff(rawPage), effectiveFrom: '2024-01-01' }]);
    expect(book.resolve({ carrier: 'BNSF', on: '2024-03-01' }).ladder.rungs).toHaveLength(1);
  });

  it('does not mistake a frozen literal for a built page', () => {
    const book = tariffBook([{ page: Object.freeze({ ...rawPage }), effectiveFrom: '2024-01-01' }]);
    const page = book.resolve({ carrier: 'BNSF', on: '2024-03-01' });
    expect(Array.isArray(page.ladder)).toBe(false);
    expect(page.ladder.rungs[0].rate).toBe(15000);
  });

  it('is empty when given nothing', () => {
    expect(tariffBook([]).size).toBe(0);
  });
});
