import { describe, expect, it } from 'vitest';
import {
  statement,
  statementCsv,
  statementRows,
  statementText,
} from '../../src/reporting/statement.js';
import { parseCsvRecords } from '../../src/io/csv.js';
import { ValidationError } from '../../src/core/errors.js';

const assessment = (carId, chargeableDays, freeUsed, gross) => ({
  carId,
  pageId: 'CON-DELTA-2024',
  chargeableDays,
  gross,
  detentions: [{}],
  counts: [{ freeUsed, allowance: 2, relief: { applied: [] } }],
});

const assessments = [assessment('BNSF 400188', 0, 1, 0), assessment('BNSF 400123', 2, 2, 19000)];

const ledger = [
  { carId: 'BNSF 400188', credits: 1, debits: 0, covered: true },
  { carId: 'BNSF 400123', credits: 0, debits: 2, covered: true },
];

describe('statementRows', () => {
  it('sorts by car', () => {
    expect(statementRows(assessments).map((row) => row.car)).toEqual([
      'BNSF 400123',
      'BNSF 400188',
    ]);
  });

  it('reads the credits off the ledger when there is one', () => {
    const rows = statementRows(assessments, ledger);
    expect(rows.find((row) => row.car === 'BNSF 400188').credits).toBe(1);
  });

  it('falls back to the chargeable days as debits with no ledger', () => {
    const rows = statementRows(assessments);
    expect(rows.find((row) => row.car === 'BNSF 400123').debits).toBe(2);
    expect(rows.every((row) => row.credits === 0)).toBe(true);
  });

  it('counts the detentions', () => {
    expect(statementRows(assessments)[0].detentions).toBe(1);
  });
});

describe('statement', () => {
  const record = statement({
    period: '202403',
    consigneeId: 'delta',
    assessments,
    ledger,
  });

  it('uppercases the consignee', () => {
    expect(record.consigneeId).toBe('DELTA');
  });

  it('totals every column', () => {
    expect(record.cars).toBe(2);
    expect(record.totalFree).toBe(3);
    expect(record.totalChargeable).toBe(2);
    expect(record.totalCredits).toBe(1);
    expect(record.totalDebits).toBe(2);
    expect(record.gross).toBe(19000);
  });

  it('needs a period and a consignee', () => {
    expect(() => statement({ consigneeId: 'DELTA', assessments })).toThrow(ValidationError);
    expect(() => statement({ period: '202403', assessments })).toThrow(ValidationError);
  });

  it('handles a consignee with no cars', () => {
    const empty = statement({ period: '202403', consigneeId: 'ACME', assessments: [] });
    expect(empty.cars).toBe(0);
    expect(empty.gross).toBe(0);
  });
});

describe('statementText', () => {
  const record = statement({ period: '202403', consigneeId: 'DELTA', assessments, ledger });

  it('heads with the consignee and the period', () => {
    expect(statementText(record).split('\n')[0]).toBe('Statement DELTA 202403');
  });

  it('counts the cars and the days in the second line', () => {
    expect(statementText(record).split('\n')[1]).toBe(
      '2 car(s), 3 free day(s), 2 chargeable day(s)'
    );
  });

  it('lists every car', () => {
    const text = statementText(record);
    expect(text).toContain('BNSF 400123');
    expect(text).toContain('BNSF 400188');
    expect(text).toContain('$190.00');
  });

  it('foots to a total with no settlement', () => {
    expect(statementText(record)).toContain('Total $190.00');
  });

  it('shows the reconciliation when there is one', () => {
    const settled = statement({
      period: '202403',
      consigneeId: 'DELTA',
      assessments,
      ledger,
      settlement: {
        earnedCredits: 1,
        openingCredits: 0,
        debits: 2,
        offsetDebits: 1,
        billableDebits: 1,
        carriedOut: 0,
      },
    });
    const text = statementText(settled);
    expect(text).toContain('Credits earned   1');
    expect(text).toContain('Billable days    1');
    expect(text).not.toContain('Total $');
  });
});

describe('statementCsv', () => {
  it('reads back through the CSV reader', () => {
    const record = statement({ period: '202403', consigneeId: 'DELTA', assessments, ledger });
    const rows = parseCsvRecords(statementCsv(record));
    expect(rows).toHaveLength(2);
    expect(rows[0].car).toBe('BNSF 400123');
  });

  it('keeps a fixed column order', () => {
    const record = statement({ period: '202403', consigneeId: 'DELTA', assessments });
    expect(statementCsv(record).split('\n')[0]).toBe(
      'car,page,detentions,free,chargeable,credits,debits,gross'
    );
  });
});
