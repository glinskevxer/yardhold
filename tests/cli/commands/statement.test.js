import { describe, expect, it } from 'vitest';
import { runStatement, statementBody, statementFor } from '../../../src/cli/commands/statement.js';
import { loadConfig } from '../../../src/config/loadConfig.js';
import { assessMonth } from '../../../src/assessment/runMonth.js';
import { ingestCsv } from '../../../src/io/ingestEvents.js';
import { OUTPUT } from '../../../src/cli/format.js';
import { parseCsvRecords } from '../../../src/io/csv.js';
import { makeReadFile, sampleDocument, sampleOptions } from '../../fixtures/world.js';
import { ValidationError } from '../../../src/core/errors.js';

const document = sampleDocument({
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
    { id: 'ACME', name: 'Acme', noticeAddress: 'c@d.example' },
  ],
  agreements: [{ id: 'AVG-1', consigneeId: 'DELTA', from: '2024-01-01', to: '2024-12-31' }],
});

const feed = [
  'car,event,event_time,track',
  'BNSF 1,AP,2024-03-04T00:00,IT-9',
  'BNSF 1,REL,2024-03-08T00:00,IT-9',
  'UP 3,AP,2024-03-04T00:00,IT-10',
  'UP 3,REL,2024-03-07T00:00,IT-10',
  '',
].join('\n');

const readFile = makeReadFile({ document, feed });
const options = { ...sampleOptions };

const world = loadConfig(document);
const result = assessMonth(world, ingestCsv(feed).events, { period: '202403', carrier: 'BNSF' });

describe('statementFor', () => {
  it('reconciles a consignee on an agreement', () => {
    const record = statementFor(world, result, 'DELTA');
    expect(record.settlement).toBeDefined();
    expect(record.settlement.debits).toBe(record.totalChargeable);
  });

  it('leaves a consignee without one unreconciled', () => {
    const record = statementFor(world, result, 'ACME');
    expect(record.settlement).toBeUndefined();
    expect(record.rows).toHaveLength(1);
  });

  it('counts the days and the money', () => {
    const record = statementFor(world, result, 'ACME');
    expect(record.totalChargeable).toBe(2);
    expect(record.gross).toBe(30000);
  });
});

describe('runStatement', () => {
  it('prints one statement per consignee by default', () => {
    const { statements, text } = runStatement(options, { readFile });
    expect(statements.map((record) => record.consigneeId)).toEqual(['ACME', 'DELTA']);
    expect(text).toContain('Statement ACME');
    expect(text).toContain('Statement DELTA');
  });

  it('narrows to one consignee when asked', () => {
    const { statements } = runStatement({ ...options, consignee: 'delta' }, { readFile });
    expect(statements).toHaveLength(1);
    expect(statements[0].consigneeId).toBe('DELTA');
  });

  it('refuses a consignee with no cars in the month', () => {
    try {
      runStatement({ ...options, consignee: 'NOBODY' }, { readFile });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.details.found).toEqual(['ACME', 'DELTA']);
    }
  });

  it('shows the reconciliation for the consignee on the agreement', () => {
    const { text } = runStatement({ ...options, consignee: 'DELTA' }, { readFile });
    expect(text).toContain('Credits earned');
    expect(text).toContain('Billable days');
  });

  it('foots to a total for the one without', () => {
    const { text } = runStatement({ ...options, consignee: 'ACME' }, { readFile });
    expect(text).toContain('Total $300.00');
  });
});

describe('statementBody', () => {
  const records = [statementFor(world, result, 'ACME'), statementFor(world, result, 'DELTA')];

  it('joins the text with a blank line', () => {
    expect(statementBody(records).split('\n\n').length).toBeGreaterThan(1);
  });

  it('writes JSON that parses', () => {
    const parsed = JSON.parse(statementBody(records, OUTPUT.JSON));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].consigneeId).toBe('ACME');
  });

  it('writes CSV that reads back', () => {
    const csv = statementBody(records, OUTPUT.CSV);
    expect(
      parseCsvRecords(csv.split('car,page')[0] + 'car,page' + csv.split('car,page')[1]).length
    ).toBeGreaterThan(0);
    expect(csv).toContain('BNSF 1');
  });
});
