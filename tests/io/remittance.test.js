import { describe, expect, it } from 'vitest';
import {
  REMITTANCE_COLUMNS,
  byConsignee,
  mapRemittanceRow,
  readRemittance,
  readRemittanceRows,
  splitInvoiceList,
} from '../../src/io/remittance.js';
import { APPLICATION } from '../../src/settlement/payment.js';
import { IngestError } from '../../src/core/errors.js';

const HEADER = 'consignee,date,amount,reference,invoices\n';

describe('splitting the advised invoice list', () => {
  it('takes a semicolon separated list', () => {
    expect(splitInvoiceList('INV-1;INV-2')).toEqual(['INV-1', 'INV-2']);
  });

  it('takes a pipe or plain spaces just as well', () => {
    expect(splitInvoiceList('INV-1|INV-2')).toEqual(['INV-1', 'INV-2']);
    expect(splitInvoiceList('INV-1 INV-2')).toEqual(['INV-1', 'INV-2']);
  });

  it('gives nothing back for a blank or missing cell', () => {
    expect(splitInvoiceList(undefined)).toEqual([]);
    expect(splitInvoiceList('   ')).toEqual([]);
  });
});

describe('reading one row', () => {
  it('builds a payment and uppercases the payer', () => {
    const record = mapRemittanceRow({
      consignee: ' delta ',
      date: '2024-05-02',
      amount: '400.00',
      reference: 'CHK-9912',
      invoices: 'INV-202403-00001',
    });
    expect(record.consigneeId).toBe('DELTA');
    expect(record.amount).toBe(40000);
    expect(record.reference).toBe('CHK-9912');
    expect(record.advisedInvoices).toEqual(['INV-202403-00001']);
    expect(record.method).toBe(APPLICATION.AS_ADVISED);
  });

  it('falls back to oldest first when the payer names nothing', () => {
    const record = mapRemittanceRow({ consignee: 'ACME', date: '2024-05-02', amount: '100.00' });
    expect(record.method).toBe(APPLICATION.OLDEST_FIRST);
    expect(record.advisedInvoices).toEqual([]);
  });

  it('accepts the column names other systems use', () => {
    const record = mapRemittanceRow({
      payer: 'ACME',
      posted: '2024-05-02',
      paid: '100.00',
      check_number: '4471',
      applied_to: 'INV-1',
    });
    expect(record.consigneeId).toBe('ACME');
    expect(record.reference).toBe('4471');
    expect(record.advisedInvoices).toEqual(['INV-1']);
  });

  it('refuses a row with no consignee, no amount or no date', () => {
    expect(() => mapRemittanceRow({ date: '2024-05-02', amount: '1.00' })).toThrow(IngestError);
    expect(() => mapRemittanceRow({ consignee: 'A', date: '2024-05-02' })).toThrow(IngestError);
    expect(() => mapRemittanceRow({ consignee: 'A', amount: '1.00' })).toThrow(IngestError);
  });

  it('names every alias it knows for a column', () => {
    expect(REMITTANCE_COLUMNS.consigneeId).toContain('payer');
    expect(REMITTANCE_COLUMNS.advisedInvoices).toContain('applied_to');
  });
});

describe('reading a file', () => {
  it('reads every row and totals them', () => {
    const result = readRemittance(
      HEADER + 'DELTA,2024-05-02,400.00,CHK-1,INV-1\n' + 'ACME,2024-05-03,150.00,CHK-2,\n'
    );
    expect(result.read).toBe(2);
    expect(result.payments).toHaveLength(2);
    expect(result.rejects).toEqual([]);
    expect(result.total).toBe(55000);
  });

  it('keeps a bad row with its line number rather than dropping it', () => {
    const result = readRemittance(
      HEADER + 'DELTA,2024-05-02,400.00,CHK-1,INV-1\n' + ',2024-05-03,150.00,CHK-2,\n'
    );
    expect(result.payments).toHaveLength(1);
    expect(result.rejects).toHaveLength(1);
    expect(result.rejects[0].line).toBe(3);
    expect(result.rejects[0].code).toBe('INGEST');
  });

  it('reads an empty file without complaining', () => {
    const result = readRemittance('');
    expect(result.payments).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('turns an unreadable row into a reject rather than falling over', () => {
    const { payments, rejects } = readRemittanceRows([null]);
    expect(payments).toEqual([]);
    expect(rejects).toHaveLength(1);
    expect(rejects[0].line).toBe(2);
  });
});

describe('totalling by consignee', () => {
  it('groups the payments and sorts by payer', () => {
    const result = readRemittance(
      HEADER +
        'DELTA,2024-05-02,400.00,CHK-1,\n' +
        'ACME,2024-05-03,150.00,CHK-2,\n' +
        'DELTA,2024-05-04,100.00,CHK-3,\n'
    );
    expect(byConsignee(result)).toEqual([
      { consigneeId: 'ACME', amount: 15000, payments: 1 },
      { consigneeId: 'DELTA', amount: 50000, payments: 2 },
    ]);
  });
});
