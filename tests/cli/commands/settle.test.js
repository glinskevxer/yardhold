import { describe, expect, it } from 'vitest';
import {
  SETTLE,
  accountsFor,
  agingBody,
  readPayments,
  runSettle,
  settleBody,
} from '../../../src/cli/commands/settle.js';
import { OUTPUT } from '../../../src/cli/format.js';
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
    { id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'a@b.example' },
    { id: 'ACME', name: 'Acme', noticeAddress: 'c@d.example', paymentTermsDays: 30 },
  ],
  tariffs: [{ page, effectiveFrom: '2024-01-01' }],
};

const feed = [
  'car,event,event_time,track',
  'BNSF 1,AP,2024-03-04T00:00,IT-9',
  'BNSF 1,REL,2024-03-08T00:00,IT-9',
  'UP 3,AP,2024-03-04T00:00,IT-10',
  'UP 3,REL,2024-03-07T00:00,IT-10',
  '',
].join('\n');

const remittance = [
  'consignee,date,amount,reference,invoices',
  'ACME,2024-04-10,150.00,CHK-77,INV-202403-00001',
  '',
].join('\n');

const readFile = (path) => {
  if (path.endsWith('world.json')) return JSON.stringify(document);
  if (path.endsWith('events.csv')) return feed;
  if (path.endsWith('pay.csv')) return remittance;
  throw new Error('ENOENT');
};

const options = {
  config: 'world.json',
  events: 'events.csv',
  period: '202403',
  carrier: 'BNSF',
  issuedOn: '2024-04-05',
};

describe('reading the remittance', () => {
  it('gives an empty result when no file was named', () => {
    expect(readPayments({}, { readFile })).toEqual({
      payments: [],
      rejects: [],
      read: 0,
      total: 0,
    });
  });

  it('reads the file when one was', () => {
    const result = readPayments({ payments: 'pay.csv' }, { readFile });
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0].consigneeId).toBe('ACME');
  });
});

describe('runSettle aging', () => {
  it('ages every open invoice when nothing has been paid', () => {
    const { text, invoices } = runSettle({ ...options, asOf: '2024-05-10' }, { readFile });
    expect(invoices).toHaveLength(2);
    expect(text).toContain('INV-202403-00001');
    expect(text).toContain('INV-202403-00002');
    expect(text).toContain('outstanding');
  });

  it('drops an invoice the remittance has paid off', () => {
    const paid = runSettle({ ...options, asOf: '2024-05-10', payments: 'pay.csv' }, { readFile });
    expect(paid.text).not.toContain('INV-202403-00001');
    expect(paid.text).toContain('INV-202403-00002');
  });

  it('ages as at the invoice date when no as-of was given', () => {
    const { text } = runSettle(options, { readFile });
    expect(text).toContain('current');
  });

  it('reports nothing open when every invoice is settled', () => {
    const body = agingBody([], [], '2024-05-10', OUTPUT.TABLE);
    expect(body).toBe('nothing open');
  });

  it('gives the buckets and the totals as json', () => {
    const { text } = runSettle({ ...options, asOf: '2024-05-10', output: 'json' }, { readFile });
    const parsed = JSON.parse(text);
    expect(parsed.asOf).toBe('2024-05-10');
    expect(parsed.buckets).toHaveProperty('over-90');
    expect(parsed.outstanding).toBeGreaterThan(0);
  });

  it('gives one row per open item as csv', () => {
    const { text } = runSettle({ ...options, asOf: '2024-05-10', output: 'csv' }, { readFile });
    expect(text.split('\n')[0]).toBe('number,consigneeId,days,bucket,amount');
  });
});

describe('runSettle account', () => {
  it('shows an account per consignee with the payment on it', () => {
    const { text } = runSettle(
      { ...options, settle: SETTLE.ACCOUNT, payments: 'pay.csv' },
      { readFile }
    );
    expect(text).toContain('Account ACME');
    expect(text).toContain('Account DELTA');
    expect(text).toContain('payment');
  });

  it('narrows to one consignee when asked', () => {
    const { text } = runSettle(
      { ...options, settle: SETTLE.ACCOUNT, consignee: 'acme' },
      { readFile }
    );
    expect(text).toContain('Account ACME');
    expect(text).not.toContain('Account DELTA');
  });

  it('refuses a consignee with no account', () => {
    expect(() =>
      runSettle({ ...options, settle: SETTLE.ACCOUNT, consignee: 'NOBODY' }, { readFile })
    ).toThrow(ValidationError);
  });

  it('builds an account for a payer who has no invoice at all', () => {
    const accounts = accountsFor(
      [],
      [{ consigneeId: 'GHOST', receivedOn: '2024-05-02', amount: 100, id: 'x' }]
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].closingBalance).toBe(-100);
  });
});

describe('picking the view', () => {
  it('refuses a kind it does not know', () => {
    expect(() => runSettle({ ...options, settle: 'nonsense' }, { readFile })).toThrow(
      ValidationError
    );
    expect(() => settleBody('nonsense', [], [], { asOf: '2024-05-10' })).toThrow();
  });

  it('needs an invoice date before it can do anything', () => {
    expect(() => runSettle({ ...options, issuedOn: undefined }, { readFile })).toThrow(
      ValidationError
    );
  });
});
