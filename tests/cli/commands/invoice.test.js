import { describe, expect, it } from 'vitest';
import {
  averageDayRate,
  buildAll,
  invoiceForConsignee,
  invoiceReport,
  invoiceRowsFor,
  runInvoice,
} from '../../../src/cli/commands/invoice.js';
import { OUTPUT } from '../../../src/cli/format.js';
import { loadConfig } from '../../../src/config/loadConfig.js';
import { SERVICE } from '../../../src/tariff/freeTimeTable.js';
import { ValidationError } from '../../../src/core/errors.js';

const page = {
  id: 'DEM-4000',
  carrier: 'BNSF',
  notificationRequired: false,
  ladder: [{ fromDay: 1, rate: '150.00' }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 2 }],
};

const document = {
  settings: { years: [2024], termsDays: 15 },
  stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
  tracks: [
    { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
    { id: 'IT-10', splc: '412300', name: 'Acme lead', capacityCars: 6, consigneeId: 'ACME' },
  ],
  parties: [
    {
      id: 'DELTA',
      name: 'Delta Chemical',
      noticeAddress: 'a@b.example',
      averageAgreementId: 'AVG-1',
    },
    { id: 'ACME', name: 'Acme', noticeAddress: 'c@d.example', paymentTermsDays: 30 },
  ],
  agreements: [{ id: 'AVG-1', consigneeId: 'DELTA', from: '2024-01-01', to: '2024-12-31' }],
  tariffs: [{ page, effectiveFrom: '2024-01-01' }],
};

const feed = [
  'car,event,event_time,track',
  'BNSF 1,AP,2024-03-04T00:00,IT-9',
  'BNSF 1,REL,2024-03-08T00:00,IT-9',
  'BNSF 2,AP,2024-03-04T00:00,IT-9',
  'BNSF 2,REL,2024-03-04T12:00,IT-9',
  'UP 3,AP,2024-03-04T00:00,IT-10',
  'UP 3,REL,2024-03-07T00:00,IT-10',
  '',
].join('\n');

const readFile = (path) => {
  if (path.endsWith('world.json')) {
    return JSON.stringify(document);
  }
  if (path.endsWith('events.csv')) {
    return feed;
  }
  throw new Error('ENOENT');
};

const options = {
  config: 'world.json',
  events: 'events.csv',
  period: '202403',
  carrier: 'BNSF',
  issuedOn: '2024-04-05',
};

describe('runInvoice', () => {
  const { invoices, text } = runInvoice(options, { readFile });

  it('cuts one invoice per consignee', () => {
    expect(invoices.map((record) => record.consigneeId)).toEqual(['ACME', 'DELTA']);
  });

  it('numbers them in order', () => {
    expect(invoices[0].number).toBe('INV-202403-00001');
    expect(invoices[1].number).toBe('INV-202403-00002');
  });

  it('takes the terms off the party when it has its own', () => {
    expect(invoices[0].termsDays).toBe(30);
    expect(invoices[1].termsDays).toBe(15);
  });

  it('prints every invoice', () => {
    expect(text).toContain('INV-202403-00001');
    expect(text).toContain('INV-202403-00002');
  });

  it('needs an issue date', () => {
    expect(() => runInvoice({ ...options, issuedOn: undefined }, { readFile })).toThrow(
      ValidationError
    );
  });
});

describe('the shape an agreement gives the invoice', () => {
  const { invoices } = runInvoice(options, { readFile });
  const acme = invoices[0];
  const delta = invoices[1];

  it('bills Acme day by day', () => {
    expect(acme.lines).toHaveLength(1);
    expect(acme.lines[0].description).toBe('demurrage day 1');
  });

  it('collapses Delta to one settled line', () => {
    expect(delta.lines).toHaveLength(1);
    expect(delta.lines[0].description).toContain('on average');
  });

  it('offsets the quick car against the slow one', () => {
    expect(delta.lines[0].description).toContain('less 1 offset');
    expect(delta.lines[0].quantity).toBe(1);
  });

  it('leaves Acme charged in full', () => {
    expect(acme.total).toBe(15000);
  });
});

describe('averageDayRate', () => {
  it('averages the rates that were actually charged', () => {
    const assessments = [{ lines: [{ rate: 10000 }, { rate: 20000 }] }];
    expect(averageDayRate(assessments)).toBe(15000);
  });

  it('falls back to the first rung when nothing was charged', () => {
    const assessments = [{ lines: [], page: { ladder: { rungs: [{ fromDay: 1, rate: 9500 }] } } }];
    expect(averageDayRate(assessments)).toBe(9500);
  });

  it('is nothing when there is nothing at all', () => {
    expect(averageDayRate([])).toBe(0);
  });
});

describe('invoiceForConsignee', () => {
  const world = loadConfig(document);
  const { result } = runInvoice(options, { readFile });

  it('builds one invoice for the consignee named', () => {
    const record = invoiceForConsignee(world, result, 'ACME', {
      sequence: 7,
      issuedOn: '2024-04-05',
    });
    expect(record.number).toBe('INV-202403-00007');
    expect(record.consigneeId).toBe('ACME');
  });

  it('carries the station off the first assessment', () => {
    const record = invoiceForConsignee(world, result, 'ACME', {
      sequence: 1,
      issuedOn: '2024-04-05',
    });
    expect(record.splc).toBe('412300');
  });

  it('builds an empty invoice for a consignee with no cars', () => {
    const record = invoiceForConsignee(world, result, 'NOBODY', {
      sequence: 1,
      issuedOn: '2024-04-05',
    });
    expect(record.total).toBe(0);
    expect(record.lines).toEqual([]);
  });

  it('builds nothing at all when the month is empty', () => {
    expect(
      buildAll(world, { period: '202403', assessments: [] }, { issuedOn: '2024-04-05' })
    ).toEqual([]);
  });
});

describe('invoiceRowsFor', () => {
  it('summarises each invoice to a row', () => {
    const { invoices } = runInvoice(options, { readFile });
    const rows = invoiceRowsFor(invoices);
    expect(rows[0]).toEqual({
      number: 'INV-202403-00001',
      consignee: 'ACME',
      lines: 1,
      due: '2024-05-05',
      total: '150.00',
    });
  });
});

describe('invoiceReport', () => {
  const { invoices } = runInvoice(options, { readFile });

  it('joins the text with a blank line between', () => {
    expect(invoiceReport(invoices).split('\n\n').length).toBeGreaterThan(1);
  });

  it('writes a JSON array that parses', () => {
    const parsed = JSON.parse(invoiceReport(invoices, { output: OUTPUT.JSON }));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].number).toBe('INV-202403-00001');
  });

  it('concatenates the CSV', () => {
    const csv = invoiceReport(invoices, { output: OUTPUT.CSV });
    expect(csv.split('\n').filter((line) => line.startsWith('car,'))).toHaveLength(2);
  });
});
