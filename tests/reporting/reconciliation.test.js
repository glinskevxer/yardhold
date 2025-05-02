import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOLERANCE_CENTS,
  VERDICT,
  agreesInFull,
  claimable,
  ofVerdict,
  reconcile,
  reconciliationSummary,
} from '../../src/reporting/reconciliation.js';
import { readCarrierInvoice } from '../../src/io/carrierInvoice.js';
import { ValidationError } from '../../src/core/errors.js';

const assessment = (carId, total, chargeableDays) => ({ carId, total, chargeableDays });

const ours = {
  period: '202403',
  assessments: [
    assessment('BNSF 400123', 30000, 2),
    assessment('GATX 77', 45000, 2),
    assessment('UP 3', 15000, 1),
  ],
};

const theirs = readCarrierInvoice(
  [
    'car,charge_date,chargeable_days,amount',
    'BNSF 400123,2024-03-05,2,300.00',
    'GATX 77,2024-03-09,3,600.00',
    'CN 90,2024-03-09,1,150.00',
    '',
  ].join('\n')
);

describe('reconcile', () => {
  const rows = reconcile(ours, theirs);

  it('lines every car up in one list', () => {
    expect(rows.map((row) => row.carId)).toEqual(['BNSF 400123', 'CN 90', 'GATX 77', 'UP 3']);
  });

  it('agrees where the totals match', () => {
    expect(rows.find((row) => row.carId === 'BNSF 400123').verdict).toBe(VERDICT.AGREED);
  });

  it('flags the car the carrier charged more for', () => {
    const row = rows.find((entry) => entry.carId === 'GATX 77');
    expect(row.verdict).toBe(VERDICT.OVERBILLED);
    expect(row.difference).toBe(15000);
  });

  it('carries both day counts so the difference can be explained', () => {
    const row = rows.find((entry) => entry.carId === 'GATX 77');
    expect(row.ourDays).toBe(2);
    expect(row.theirDays).toBe(3);
  });

  it('flags the car we assessed and they never billed', () => {
    const row = rows.find((entry) => entry.carId === 'UP 3');
    expect(row.verdict).toBe(VERDICT.UNBILLED);
    expect(row.theirs).toBe(0);
  });

  it('flags the car they billed and we never assessed', () => {
    const row = rows.find((entry) => entry.carId === 'CN 90');
    expect(row.verdict).toBe(VERDICT.NOT_ASSESSED);
    expect(row.ours).toBe(0);
  });

  it('needs both sides', () => {
    expect(() => reconcile(undefined, theirs)).toThrow(ValidationError);
    expect(() => reconcile(ours, undefined)).toThrow(ValidationError);
  });
});

describe('underbilling', () => {
  it('is reported rather than quietly welcomed', () => {
    const light = readCarrierInvoice('car,amount\nBNSF 400123,100.00\n');
    const rows = reconcile({ assessments: [assessment('BNSF 400123', 30000, 2)] }, light);
    expect(rows[0].verdict).toBe(VERDICT.UNDERBILLED);
    expect(rows[0].difference).toBe(-20000);
  });
});

describe('the tolerance', () => {
  it('lets a cent or two pass', () => {
    const close = readCarrierInvoice('car,amount\nBNSF 400123,300.02\n');
    const rows = reconcile({ assessments: [assessment('BNSF 400123', 30000, 2)] }, close);
    expect(rows[0].verdict).toBe(VERDICT.AGREED);
    expect(DEFAULT_TOLERANCE_CENTS).toBe(2);
  });

  it('does not let three cents pass', () => {
    const close = readCarrierInvoice('car,amount\nBNSF 400123,300.03\n');
    const rows = reconcile({ assessments: [assessment('BNSF 400123', 30000, 2)] }, close);
    expect(rows[0].verdict).toBe(VERDICT.OVERBILLED);
  });

  it('takes a tolerance of its own', () => {
    const close = readCarrierInvoice('car,amount\nBNSF 400123,300.03\n');
    const rows = reconcile({ assessments: [assessment('BNSF 400123', 30000, 2)] }, close, {
      toleranceCents: 10,
    });
    expect(rows[0].verdict).toBe(VERDICT.AGREED);
  });
});

describe('a car assessed at nothing and never billed', () => {
  it('agrees rather than being flagged unbilled', () => {
    const rows = reconcile(
      { assessments: [assessment('BNSF 400123', 0, 0)] },
      readCarrierInvoice('')
    );
    expect(rows[0].verdict).toBe(VERDICT.AGREED);
    expect(agreesInFull(rows)).toBe(true);
  });
});

describe('summaries', () => {
  const rows = reconcile(ours, theirs);

  it('counts by verdict', () => {
    expect(reconciliationSummary(rows).byVerdict).toEqual({
      agreed: 1,
      'not-assessed': 1,
      overbilled: 1,
      unbilled: 1,
    });
  });

  it('totals both sides', () => {
    const summary = reconciliationSummary(rows);
    expect(summary.ours).toBe(90000);
    expect(summary.theirs).toBe(105000);
    expect(summary.difference).toBe(15000);
  });

  it('totals only what can actually be claimed', () => {
    expect(reconciliationSummary(rows).claimable).toBe(15000);
  });

  it('slices to one verdict', () => {
    expect(ofVerdict(rows, VERDICT.AGREED)).toHaveLength(1);
    expect(claimable(rows).map((row) => row.carId)).toEqual(['GATX 77']);
  });

  it('says so when everything agrees', () => {
    expect(agreesInFull(rows)).toBe(false);
    expect(agreesInFull([])).toBe(true);
  });
});
