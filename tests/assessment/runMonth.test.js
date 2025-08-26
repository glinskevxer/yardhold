import { describe, expect, it } from 'vitest';
import {
  assessMonth,
  resolveCar,
  assessmentsFor,
  consigneesIn,
  monthTotal,
  periodBounds,
} from '../../src/assessment/runMonth.js';
import { loadConfig } from '../../src/config/loadConfig.js';
import { trackEvent } from '../../src/events/event.js';
import { SERVICE } from '../../src/tariff/freeTimeTable.js';
import { parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const page = (id, rate) => ({
  id,
  carrier: 'BNSF',
  notificationRequired: false,
  ladder: [{ fromDay: 1, rate }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
});

const world = loadConfig({
  settings: { years: [2024] },
  stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
  tracks: [
    { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
    { id: 'IT-10', splc: '412300', name: 'Acme lead', capacityCars: 6, consigneeId: 'ACME' },
  ],
  parties: [
    { id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'a@b.example' },
    { id: 'ACME', name: 'Acme', noticeAddress: 'c@d.example' },
  ],
  cars: [{ id: 'BNSF 400123', designation: 'XM' }],
  tariffs: [
    { page: page('DEM-4000', '150.00'), effectiveFrom: '2024-01-01' },
    { page: page('CON-DELTA', '95.00'), effectiveFrom: '2024-01-01', consigneeId: 'DELTA' },
  ],
});

const at = (text) => parseInstant(text, -360);
const build = (rows) => rows.map(trackEvent);

describe('periodBounds', () => {
  it('spans the whole month at the station offset', () => {
    const bounds = periodBounds('202403', -360);
    expect(bounds.firstDay).toBe('2024-03-01');
    expect(bounds.lastDay).toBe('2024-03-31');
    expect(bounds.from).toBe(at('2024-03-01T00:00'));
    expect(bounds.to).toBe(at('2024-04-01T00:00'));
  });

  it('handles February in a leap year', () => {
    expect(periodBounds('202402').lastDay).toBe('2024-02-29');
  });

  it('needs a period', () => {
    expect(() => periodBounds(undefined)).toThrow(ValidationError);
  });
});

describe('assessMonth', () => {
  const events = build([
    { carId: 'BNSF 400123', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
    { carId: 'BNSF 400123', code: 'REL', at: '2024-03-08T00:00' },
    { carId: 'UP 3', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-10' },
    { carId: 'UP 3', code: 'REL', at: '2024-03-07T00:00' },
  ]);

  it('assesses every car it can place', () => {
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments).toHaveLength(2);
    expect(result.skipped).toEqual([]);
  });

  it('picks the consignee page for the Delta car and the general one for Acme', () => {
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    const delta = assessmentsFor(result, 'DELTA')[0];
    const acme = assessmentsFor(result, 'ACME')[0];
    expect(delta.pageId).toBe('CON-DELTA');
    expect(acme.pageId).toBe('DEM-4000');
  });

  it('prices the same three days differently under the two pages', () => {
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(assessmentsFor(result, 'DELTA')[0].total).toBe(3 * 9500);
    expect(assessmentsFor(result, 'ACME')[0].total).toBe(2 * 15000);
  });

  it('reads the station and the consignee off the track', () => {
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments.every((entry) => entry.splc === '412300')).toBe(true);
    expect(consigneesIn(result)).toEqual(['ACME', 'DELTA']);
  });

  it('totals the month', () => {
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(monthTotal(result)).toBe(3 * 9500 + 2 * 15000);
  });
});

describe('cars it cannot place', () => {
  it('skips a car on a track this office does not know', () => {
    const events = build([
      { carId: 'BNSF 1', code: 'AP', at: '2024-03-04T00:00', trackId: 'FOREIGN-1' },
      { carId: 'BNSF 1', code: 'REL', at: '2024-03-08T00:00' },
    ]);
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments).toEqual([]);
    expect(result.skipped[0].why).toBe('no track this office knows');
  });

  it('skips a car with no track at all', () => {
    const events = build([{ carId: 'BNSF 1', code: 'ARR', at: '2024-03-04T00:00' }]);
    expect(assessMonth(world, events, { period: '202403', carrier: 'BNSF' }).skipped).toHaveLength(
      1
    );
  });

  it('skips a car whose carrier has nothing on file', () => {
    const events = build([
      { carId: 'BNSF 1', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
      { carId: 'BNSF 1', code: 'REL', at: '2024-03-08T00:00' },
    ]);
    const result = assessMonth(world, events, { period: '202403', carrier: 'CSXT' });
    expect(result.skipped[0].why).toBe('no tariff page on file');
  });
});

describe('the waybill decides the query', () => {
  const withBills = loadConfig({
    settings: { years: [2024] },
    stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
    tracks: [
      { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
    ],
    parties: [{ id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'a@b.example' }],
    cars: [{ id: 'BNSF 400123', designation: 'XM' }],
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
    tariffs: [
      {
        page: {
          id: 'DEM-4000',
          carrier: 'BNSF',
          notificationRequired: false,
          ladder: [{ fromDay: 1, rate: '150.00' }],
          freeTime: [
            { service: SERVICE.UNLOADING, days: 1 },
            { service: SERVICE.UNLOADING, days: 4, commodityClass: 'GRAIN' },
          ],
        },
        effectiveFrom: '2024-01-01',
      },
    ],
  });

  const events = build([
    { carId: 'BNSF 400123', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
    { carId: 'BNSF 400123', code: 'REL', at: '2024-03-08T00:00' },
  ]);

  it('reads the commodity class off the waybill', () => {
    const result = assessMonth(withBills, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments[0].commodityClass).toBe('GRAIN');
  });

  it('reads the service off the movement', () => {
    const result = assessMonth(withBills, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments[0].service).toBe('unloading');
  });

  it('spends the commodity allowance rather than the bare one', () => {
    const result = assessMonth(withBills, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments[0].chargeableDays).toBe(0);
  });

  it('falls back to the bare line for a car with no waybill', () => {
    const bare = build([
      { carId: 'UP 9', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
      { carId: 'UP 9', code: 'REL', at: '2024-03-08T00:00' },
    ]);
    const result = assessMonth(withBills, bare, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments[0].commodityClass).toBeUndefined();
    expect(result.assessments[0].chargeableDays).toBe(3);
  });

  it('still takes an explicit service when the caller names one', () => {
    const result = assessMonth(withBills, events, {
      period: '202403',
      carrier: 'BNSF',
      service: SERVICE.LOADING,
    });
    expect(result.assessments[0].service).toBe('loading');
  });
});

describe('suspensions reported in the feed', () => {
  const events = build([
    { carId: 'BNSF 400123', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
    { carId: 'BNSF 400123', code: 'BO', at: '2024-03-05T00:00' },
    { carId: 'BNSF 400123', code: 'BOR', at: '2024-03-06T00:00' },
    { carId: 'BNSF 400123', code: 'REL', at: '2024-03-08T00:00' },
  ]);

  it('turns the pair into relief', () => {
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments[0].suspensions).toHaveLength(1);
  });

  it('takes the bad order day off the count', () => {
    const withPair = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    const without = assessMonth(
      world,
      build([
        { carId: 'BNSF 400123', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
        { carId: 'BNSF 400123', code: 'REL', at: '2024-03-08T00:00' },
      ]),
      { period: '202403', carrier: 'BNSF' }
    );
    expect(withPair.assessments[0].chargeableDays).toBe(without.assessments[0].chargeableDays - 1);
  });

  it('reports a bad order that was never lifted', () => {
    const open = build([
      { carId: 'BNSF 400123', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
      { carId: 'BNSF 400123', code: 'BO', at: '2024-03-05T00:00' },
    ]);
    const result = assessMonth(world, open, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments[0].unclosedSuspensions).toEqual([]);
    expect(result.assessments[0].suspensions).toHaveLength(1);
  });

  it('leaves an ordinary car with no suspensions', () => {
    const plain = build([
      { carId: 'BNSF 400123', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
      { carId: 'BNSF 400123', code: 'REL', at: '2024-03-08T00:00' },
    ]);
    const result = assessMonth(world, plain, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments[0].suspensions).toEqual([]);
  });
});

describe('the waybill is read on the day the car was placed', () => {
  const withLateBill = loadConfig({
    settings: { years: [2024] },
    stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
    tracks: [
      { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
    ],
    parties: [{ id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'a@b.example' }],
    cars: [{ id: 'BNSF 400123', designation: 'XM' }],
    waybills: [
      {
        number: 'WB-1',
        carId: 'BNSF 400123',
        movement: 'inbound-loaded',
        billedOn: '2024-03-02',
        commodityCode: '0113210',
        netWeightPounds: 190000,
      },
    ],
    tariffs: [
      {
        page: {
          id: 'DEM-4000',
          carrier: 'BNSF',
          notificationRequired: false,
          ladder: [{ fromDay: 1, rate: '150.00' }],
          freeTime: [
            { service: SERVICE.UNLOADING, days: 1 },
            { service: SERVICE.UNLOADING, days: 4, commodityClass: 'GRAIN' },
          ],
        },
        effectiveFrom: '2024-01-01',
      },
    ],
  });

  const events = build([
    { carId: 'BNSF 400123', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
    { carId: 'BNSF 400123', code: 'REL', at: '2024-03-08T00:00' },
  ]);

  it('finds a waybill billed after the first of the month', () => {
    const result = assessMonth(withLateBill, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments[0].commodityClass).toBe('GRAIN');
  });

  it('spends the commodity allowance rather than the bare one', () => {
    const result = assessMonth(withLateBill, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments[0].chargeableDays).toBe(0);
  });

  it('records the day it read the waybill on', () => {
    const entry = resolveCar(withLateBill, 'BNSF 400123', events, {
      carrier: 'BNSF',
      bounds: periodBounds('202403'),
    });
    expect(entry.placedOn).toBe('2024-03-04');
  });

  it('falls back to the first of the month when the car was never placed', () => {
    const entry = resolveCar(
      withLateBill,
      'BNSF 400123',
      build([{ carId: 'BNSF 400123', code: 'ARR', at: '2024-03-04T00:00' }]),
      { carrier: 'BNSF', bounds: periodBounds('202403') }
    );
    expect(entry.skip).toBe('no track this office knows');
  });
});

describe('bunching relief reaches the count', () => {
  const document = {
    settings: { years: [2024] },
    stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
    tracks: [
      { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 8, consigneeId: 'DELTA' },
    ],
    parties: [{ id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'a@b.example' }],
    orders: [
      { consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-04', cars: 1 },
      { consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-05', cars: 1 },
      { consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-06', cars: 1 },
    ],
    tariffs: [
      {
        page: {
          id: 'DEM-4000',
          carrier: 'BNSF',
          notificationRequired: false,
          bunchingRelief: true,
          ladder: [{ fromDay: 1, rate: '150.00' }],
          freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
        },
        effectiveFrom: '2024-01-01',
      },
    ],
  };

  const bunched = ['BNSF 1', 'BNSF 2', 'BNSF 3'].flatMap((carId) =>
    build([
      { carId, code: 'AP', at: '2024-03-06T00:00', trackId: 'IT-9' },
      { carId, code: 'REL', at: '2024-03-12T00:00' },
    ])
  );

  it('relieves the cars that filled an older order', () => {
    const result = assessMonth(loadConfig(document), bunched, {
      period: '202403',
      carrier: 'BNSF',
    });
    const bonuses = result.assessments.map((entry) => entry.extraFreeDays).sort();
    expect(bonuses).toEqual([0, 1, 2]);
  });

  it('charges those cars less than the same stand with no orders on file', () => {
    const withOrders = assessMonth(loadConfig(document), bunched, {
      period: '202403',
      carrier: 'BNSF',
    });
    const without = assessMonth(loadConfig({ ...document, orders: [] }), bunched, {
      period: '202403',
      carrier: 'BNSF',
    });
    expect(monthTotal(withOrders)).toBeLessThan(monthTotal(without));
  });

  it('gives nothing on a page that grants no bunching relief', () => {
    const plain = {
      ...document,
      tariffs: [
        {
          page: { ...document.tariffs[0].page, bunchingRelief: false },
          effectiveFrom: '2024-01-01',
        },
      ],
    };
    const result = assessMonth(loadConfig(plain), bunched, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments.every((entry) => entry.extraFreeDays === 0)).toBe(true);
  });

  it('gives nothing when no orders were filed at all', () => {
    const result = assessMonth(loadConfig({ ...document, orders: [] }), bunched, {
      period: '202403',
      carrier: 'BNSF',
    });
    expect(result.assessments.every((entry) => entry.extraFreeDays === 0)).toBe(true);
  });

  it('gives nothing to a single car that was merely late', () => {
    const lone = build([
      { carId: 'BNSF 1', code: 'AP', at: '2024-03-06T00:00', trackId: 'IT-9' },
      { carId: 'BNSF 1', code: 'REL', at: '2024-03-12T00:00' },
    ]);
    const result = assessMonth(loadConfig(document), lone, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments[0].extraFreeDays).toBe(0);
  });
});

describe('the period cut off', () => {
  it('bills a car still standing at month end to the cut off', () => {
    const events = build([
      { carId: 'BNSF 400123', code: 'AP', at: '2024-03-28T00:00', trackId: 'IT-9' },
    ]);
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments[0].chargeableDays).toBe(3);
  });

  it('ignores events that land after the cut off', () => {
    const events = build([
      { carId: 'BNSF 400123', code: 'AP', at: '2024-03-28T00:00', trackId: 'IT-9' },
      { carId: 'BNSF 400123', code: 'REL', at: '2024-04-10T00:00' },
    ]);
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments[0].chargeableDays).toBe(3);
  });

  it('needs a world and a carrier', () => {
    expect(() => assessMonth(undefined, [], { period: '202403', carrier: 'BNSF' })).toThrow(
      ValidationError
    );
    expect(() => assessMonth(world, [], { period: '202403' })).toThrow(ValidationError);
  });
});
