import { SERVICE } from '../../src/tariff/freeTimeTable.js';

/**
 * One small world, shared by the command tests.
 *
 * Every one of them had grown its own copy of the same station, track, party
 * and page, and they had drifted: two of them were testing against a page that
 * required notification and one against a page that did not, which made the
 * same event feed produce different day counts for no stated reason.
 */

export const samplePage = Object.freeze({
  id: 'DEM-4000',
  carrier: 'BNSF',
  notificationRequired: false,
  ladder: [{ fromDay: 1, rate: '150.00' }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
});

export function sampleDocument(overrides = {}) {
  return {
    settings: { years: [2024] },
    stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
    tracks: [
      { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
    ],
    parties: [{ id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'a@b.example' }],
    cars: [{ id: 'BNSF 400123', designation: 'XM' }],
    tariffs: [{ page: samplePage, effectiveFrom: '2024-01-01' }],
    ...overrides,
  };
}

export const sampleFeed = [
  'car,event,event_time,track',
  'BNSF 400123,AP,2024-03-04T00:00,IT-9',
  'BNSF 400123,REL,2024-03-08T00:00,IT-9',
  'UP 3,AP,2024-03-04T00:00,FOREIGN-1',
  '',
].join('\n');

export const sampleCarrierInvoice = [
  'car,charge_date,chargeable_days,amount',
  'BNSF 400123,2024-03-05,4,600.00',
  '',
].join('\n');

/** A reader that answers for the three files every command test needs. */
export function makeReadFile({
  document = sampleDocument(),
  feed = sampleFeed,
  carrier = sampleCarrierInvoice,
  extra = {},
} = {}) {
  return (path) => {
    for (const [suffix, contents] of Object.entries(extra)) {
      if (path.endsWith(suffix)) {
        return contents;
      }
    }
    if (path.endsWith('world.json')) {
      return JSON.stringify(document);
    }
    if (path.endsWith('events.csv')) {
      return feed;
    }
    if (path.endsWith('carrier.csv')) {
      return carrier;
    }
    throw new Error('ENOENT');
  };
}

export const sampleOptions = Object.freeze({
  config: 'world.json',
  events: 'events.csv',
  period: '202403',
  carrier: 'BNSF',
});
