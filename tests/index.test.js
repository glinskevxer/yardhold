import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

/**
 * The public surface is a promise, so it is checked rather than assumed. A name
 * disappearing from here is a breaking change and should read like one in the
 * diff.
 */

const EXPECTED = [
  'ACTION',
  'CHANGE',
  'CHARGE_TYPE',
  'CLAIM_STATUS',
  'CREDIT_BASIS',
  'DAY_KIND',
  'EVENT_SOURCE',
  'EVIDENCE',
  'EXCEPTION',
  'EXCLUSION',
  'GROUND',
  'HIRE_BASIS',
  'INVOICE_STATUS',
  'LADDER_RESET',
  'LOAD_STATE',
  'MOVEMENT',
  'NotFoundError',
  'PLACEMENT',
  'PROBLEM',
  'RENDER_FORMAT',
  'SERVICE',
  'SERVICE_KIND',
  'STANDARD_COMMODITIES',
  'SWITCH_KIND',
  'SpurtallyError',
  'VERDICT',
  'VERSION',
  'ValidationError',
  'WRITE_OFF_REASON',
];

describe('the public surface', () => {
  it('exports every name it promises', () => {
    for (const name of EXPECTED) {
      expect(api[name], name).toBeDefined();
    }
  });

  it('exports the entry points as functions', () => {
    for (const name of [
      'loadConfig',
      'ingestCsv',
      'assessMonth',
      'buildInvoice',
      'renderInvoice',
      'reconcileCarrier',
      'validateWorld',
      'runCli',
    ]) {
      expect(typeof api[name], name).toBe('function');
    }
  });

  it('keeps the two reconcilers apart under different names', () => {
    expect(api.reconcileAverage).not.toBe(api.reconcileCarrier);
    expect(typeof api.reconcileAverage).toBe('function');
  });

  it('exports no undefined bindings', () => {
    for (const [name, value] of Object.entries(api)) {
      expect(value, name).not.toBeUndefined();
    }
  });

  it('carries a version that looks like one', () => {
    expect(api.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('a month through the public surface only', () => {
  it('loads, ingests, assesses and invoices', () => {
    const world = api.loadConfig({
      settings: { years: [2024] },
      stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
      tracks: [
        { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
      ],
      parties: [{ id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'a@b.example' }],
      tariffs: [
        {
          page: {
            id: 'DEM-4000',
            carrier: 'BNSF',
            notificationRequired: false,
            ladder: [{ fromDay: 1, rate: '150.00' }],
            freeTime: [{ service: api.SERVICE.UNLOADING, days: 1 }],
          },
          effectiveFrom: '2024-01-01',
        },
      ],
    });
    expect(api.validateWorld(world)).toEqual([]);

    const feed = api.ingestCsv(
      [
        'car,event,event_time,track',
        'BNSF 400123,AP,2024-03-04T00:00,IT-9',
        'BNSF 400123,REL,2024-03-08T00:00,IT-9',
        '',
      ].join('\n')
    );
    expect(feed.rejects).toEqual([]);

    const result = api.assessMonth(world, feed.events, { period: '202403', carrier: 'BNSF' });
    expect(api.monthTotal(result)).toBe(45000);

    const record = api.buildInvoice({
      sequence: 1,
      period: '202403',
      consigneeId: 'DELTA',
      issuedOn: '2024-04-05',
      assessments: result.assessments,
    });
    expect(record.total).toBe(45000);
    expect(api.renderInvoice(record)).toContain('INV-202403-00001');
  });

  it('reconciles against a carrier invoice through the surface', () => {
    const carrier = api.readCarrierInvoice('car,amount\nBNSF 400123,600.00\n');
    const rows = api.reconcileCarrier(
      { assessments: [{ carId: 'BNSF 400123', total: 45000, chargeableDays: 3 }] },
      carrier
    );
    expect(rows[0].verdict).toBe(api.VERDICT.OVERBILLED);
  });
});
