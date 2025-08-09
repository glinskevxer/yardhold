import { describe, expect, it } from 'vitest';
import {
  agreementFor,
  calendarFor,
  loadConfig,
  pageFor,
  worldSummary,
} from '../../src/config/loadConfig.js';
import { SERVICE } from '../../src/tariff/freeTimeTable.js';
import { NotFoundError, ValidationError } from '../../src/core/errors.js';

const document = {
  settings: { years: [2024], termsDays: 30 },
  stations: [
    { splc: '412300', name: 'Memphis North', carrier: 'BNSF' },
    { splc: '509100', name: 'Cordova', carrier: 'UP', offsetMinutes: -300 },
  ],
  tracks: [
    { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
  ],
  parties: [
    {
      id: 'DELTA',
      name: 'Delta Chemical',
      noticeAddress: 'rail@delta.example',
      averageAgreementId: 'AVG-1',
    },
    { id: 'ACME', name: 'Acme', noticeAddress: 'ap@acme.example' },
  ],
  cars: [{ id: 'BNSF 400123', designation: 'XM' }],
  tariffs: [
    {
      page: {
        id: 'DEM-4000',
        carrier: 'BNSF',
        ladder: [{ fromDay: 1, rate: '150.00' }],
        freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
      },
      effectiveFrom: '2024-01-01',
    },
  ],
  agreements: [{ id: 'AVG-1', consigneeId: 'DELTA', from: '2024-01-01', to: '2024-12-31' }],
  orders: [{ consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-04', cars: 2 }],
  switchRates: [{ kind: 'intra-plant', rate: '340.00' }],
  hireRates: [{ carKind: 'boxcar', hourlyRate: '0.7500' }],
};

describe('loadConfig', () => {
  const world = loadConfig(document);

  it('builds every book', () => {
    expect(worldSummary(world)).toEqual({
      stations: 2,
      tracks: 1,
      parties: 2,
      cars: 1,
      calendars: 2,
      tariffs: 1,
      agreements: 1,
      orders: 1,
      exclusions: 0,
      commodities: 6,
      waybills: 0,
      supplements: 0,
      leases: 0,
      scaleTickets: 0,
    });
  });

  it('falls back to the standard commodity book when none is given', () => {
    expect(world.commodities.classOf('0113210')).toBe('GRAIN');
  });

  it('takes a commodity book of its own', () => {
    const custom = loadConfig({
      ...document,
      commodities: [{ code: '0113210', name: 'corn', commodityClass: 'FEED' }],
    });
    expect(custom.commodities.size).toBe(1);
    expect(custom.commodities.classOf('0113210')).toBe('FEED');
  });

  it('indexes the waybills by car', () => {
    const withBills = loadConfig({
      ...document,
      waybills: [
        {
          number: 'WB-1',
          carId: 'BNSF 400123',
          movement: 'inbound-loaded',
          billedOn: '2024-03-01',
          commodityCode: '0113210',
          netWeightPounds: 190000,
        },
      ],
    });
    expect(withBills.waybills.forCar('BNSF 400123')).toHaveLength(1);
  });

  it('carries the settings through', () => {
    expect(world.settings.termsDays).toBe(30);
    expect(world.settings.years).toEqual([2024]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(world)).toBe(true);
  });

  it('still checks the document', () => {
    expect(() => loadConfig({ stations: [] })).toThrow(ValidationError);
  });

  it('loads happily with only the required sections', () => {
    const bare = loadConfig({ stations: [], tracks: [], parties: [], tariffs: [] });
    expect(worldSummary(bare).stations).toBe(0);
  });
});

describe('calendars', () => {
  const world = loadConfig(document);

  it('makes one per station when none was given', () => {
    expect(world.calendars.has('BNSF-412300')).toBe(true);
    expect(world.calendars.has('UP-509100')).toBe(true);
  });

  it('takes the offset off the station', () => {
    expect(calendarFor(world, '509100').offsetMinutes).toBe(-300);
    expect(calendarFor(world, '412300').offsetMinutes).toBe(-360);
  });

  it('knows the holidays for the configured years', () => {
    expect(calendarFor(world, '412300').holidays.size).toBe(6);
  });

  it('prefers a calendar written down in the document', () => {
    const shared = loadConfig({
      ...document,
      calendars: [{ id: 'BNSF-412300', serviceDays: [1, 2, 3, 4, 5, 6], offsetMinutes: -360 }],
    });
    expect(calendarFor(shared, '412300').serviceDays).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('throws for a station it does not hold', () => {
    expect(() => calendarFor(world, '999999')).toThrow(NotFoundError);
  });
});

describe('agreementFor', () => {
  const world = loadConfig(document);

  it('finds the agreement a party names', () => {
    expect(agreementFor(world, 'DELTA').id).toBe('AVG-1');
  });

  it('is nothing for a party with no agreement', () => {
    expect(agreementFor(world, 'ACME')).toBeUndefined();
  });

  it('is nothing for a party it does not hold', () => {
    expect(agreementFor(world, 'NOBODY')).toBeUndefined();
  });

  it('is nothing when the agreement is not in the book', () => {
    const broken = loadConfig({ ...document, agreements: [] });
    expect(agreementFor(broken, 'DELTA')).toBeUndefined();
  });
});

describe('pageFor', () => {
  const world = loadConfig(document);

  it('resolves through the tariff book', () => {
    expect(pageFor(world, { carrier: 'BNSF', on: '2024-03-04' }).id).toBe('DEM-4000');
  });

  it('throws when nothing is on file', () => {
    expect(() => pageFor(world, { carrier: 'CSXT', on: '2024-03-04' })).toThrow(NotFoundError);
  });
});
