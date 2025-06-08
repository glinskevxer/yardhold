import { describe, expect, it } from 'vitest';
import {
  disagreements,
  reconcileBody,
  reconciliationRows,
  runReconcile,
} from '../../../src/cli/commands/reconcile.js';
import { VERDICT } from '../../../src/reporting/reconciliation.js';
import { OUTPUT } from '../../../src/cli/format.js';
import { ValidationError } from '../../../src/core/errors.js';
import { makeReadFile, sampleOptions } from '../../fixtures/world.js';

const feed = [
  'car,event,event_time,track',
  'BNSF 400123,AP,2024-03-04T00:00,IT-9',
  'BNSF 400123,REL,2024-03-08T00:00,IT-9',
  'UP 3,AP,2024-03-04T00:00,IT-9',
  'UP 3,REL,2024-03-06T00:00,IT-9',
  '',
].join('\n');

const carrier = [
  'car,charge_date,chargeable_days,amount',
  'BNSF 400123,2024-03-05,4,600.00',
  'UP 3,2024-03-05,1,150.00',
  '',
].join('\n');

const readFile = makeReadFile({ feed, carrier });
const options = { ...sampleOptions, carrierInvoice: 'carrier.csv' };

describe('runReconcile', () => {
  const { rows, text } = runReconcile(options, { readFile });

  it('lines both sides up', () => {
    expect(rows).toHaveLength(2);
  });

  it('spots the car the carrier overbilled', () => {
    const row = rows.find((entry) => entry.carId === 'BNSF 400123');
    expect(row.verdict).toBe(VERDICT.OVERBILLED);
    expect(row.difference).toBe(15000);
  });

  it('agrees on the other one', () => {
    expect(rows.find((entry) => entry.carId === 'UP 3').verdict).toBe(VERDICT.AGREED);
  });

  it('shows only the disagreement by default', () => {
    expect(text).toContain('BNSF 400123');
    expect(text).not.toContain('UP 3');
  });

  it('foots with the claimable figure', () => {
    expect(text).toMatch(/claimable\s+150\.00/);
  });

  it('needs a carrier invoice', () => {
    expect(() => runReconcile({ ...options, carrierInvoice: undefined }, { readFile })).toThrow(
      ValidationError
    );
  });

  it('needs one it can read', () => {
    expect(() => runReconcile({ ...options, carrierInvoice: 'missing.csv' }, { readFile })).toThrow(
      /could not read/
    );
  });

  it('takes a tolerance that makes the difference disappear', () => {
    const { rows: wide } = runReconcile({ ...options, tolerance: '20000' }, { readFile });
    expect(wide.every((row) => row.verdict === VERDICT.AGREED)).toBe(true);
  });
});

describe('reconcileBody', () => {
  const { rows } = runReconcile(options, { readFile });

  it('shows everything when asked', () => {
    const text = reconcileBody(rows, { all: true });
    expect(text).toContain('UP 3');
  });

  it('says so when nothing disagrees', () => {
    const agreed = rows.filter((row) => row.verdict === VERDICT.AGREED);
    expect(reconcileBody(agreed)).toContain('every car agrees');
  });

  it('writes JSON with the summary folded in', () => {
    const parsed = JSON.parse(reconcileBody(rows, { output: OUTPUT.JSON }));
    expect(parsed.summary.claimable).toBe(15000);
    expect(parsed.rows).toHaveLength(1);
  });

  it('writes a CSV with no footer', () => {
    const csv = reconcileBody(rows, { output: OUTPUT.CSV });
    expect(csv).not.toContain('claimable');
    expect(csv.split('\n')[0]).toBe('car,verdict,ourDays,theirDays,ours,theirs,difference');
  });
});

describe('the helpers', () => {
  const { rows } = runReconcile(options, { readFile });

  it('drops the agreed rows', () => {
    expect(disagreements(rows)).toHaveLength(1);
  });

  it('formats the money and blanks the missing day counts', () => {
    const formatted = reconciliationRows([
      { carId: 'A', verdict: 'unbilled', ours: 15000, theirs: 0, difference: -15000 },
    ]);
    expect(formatted[0]).toEqual({
      car: 'A',
      verdict: 'unbilled',
      ourDays: '',
      theirDays: '',
      ours: '150.00',
      theirs: '0.00',
      difference: '-150.00',
    });
  });
});
