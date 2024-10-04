import { describe, expect, it } from 'vitest';
import {
  DECISION_DAYS,
  DEFAULT_WINDOWS,
  barredReason,
  daysLate,
  decisionDeadline,
  filingDeadline,
  filingWindowDays,
  groundsStillOpen,
  isDecisionOverdue,
  isTimely,
} from '../../src/disputes/timeLimits.js';
import { GROUND, claim } from '../../src/disputes/claim.js';
import { ValidationError } from '../../src/core/errors.js';

const filed = (ground, filedOn) =>
  claim({
    sequence: 1,
    period: '202404',
    invoiceNumber: 'INV-202403-00012',
    consigneeId: 'DELTA',
    ground,
    filedOn,
    amountClaimed: 45000,
    evidence: ['x'],
  });

const invoicedOn = '2024-04-05';

describe('the windows', () => {
  it('gives an events claim ninety days', () => {
    expect(filingWindowDays(GROUND.WRONG_EVENTS)).toBe(90);
  });

  it('gives an arithmetic claim a year', () => {
    expect(filingWindowDays(GROUND.ARITHMETIC)).toBe(365);
  });

  it('gives nothing for a ground it does not know', () => {
    expect(filingWindowDays('unhappy')).toBe(0);
  });

  it('takes a table of its own', () => {
    expect(filingWindowDays(GROUND.WRONG_EVENTS, { [GROUND.WRONG_EVENTS]: 30 })).toBe(30);
  });

  it('covers every ground in the default table', () => {
    expect(Object.keys(DEFAULT_WINDOWS).sort()).toEqual(Object.values(GROUND).sort());
  });
});

describe('filingDeadline', () => {
  it('counts from the invoice date', () => {
    expect(filingDeadline(invoicedOn, GROUND.WRONG_EVENTS)).toBe('2024-07-04');
  });

  it('is later on a longer window', () => {
    expect(filingDeadline(invoicedOn, GROUND.ARITHMETIC)).toBe('2025-04-05');
  });
});

describe('isTimely', () => {
  it('accepts a claim on the deadline itself', () => {
    expect(isTimely(filed(GROUND.WRONG_EVENTS, '2024-07-04'), invoicedOn)).toBe(true);
  });

  it('bars one filed the day after', () => {
    expect(isTimely(filed(GROUND.WRONG_EVENTS, '2024-07-05'), invoicedOn)).toBe(false);
  });

  it('accepts the same day on a longer window', () => {
    expect(isTimely(filed(GROUND.ARITHMETIC, '2024-07-05'), invoicedOn)).toBe(true);
  });

  it('counts how late a barred claim was', () => {
    expect(daysLate(filed(GROUND.WRONG_EVENTS, '2024-07-14'), invoicedOn)).toBe(10);
  });

  it('reports nothing late for a timely claim', () => {
    expect(daysLate(filed(GROUND.WRONG_EVENTS, '2024-05-01'), invoicedOn)).toBe(0);
  });
});

describe('the same facts on two grounds', () => {
  it('is barred on one and open on the other', () => {
    expect(isTimely(filed(GROUND.WRONG_EVENTS, '2024-09-01'), invoicedOn)).toBe(false);
    expect(isTimely(filed(GROUND.WRONG_TARIFF, '2024-09-01'), invoicedOn)).toBe(true);
  });

  it('lists what is still open on a day', () => {
    expect(groundsStillOpen('2024-09-01', invoicedOn)).toEqual([
      'arithmetic',
      'wrong-party',
      'wrong-tariff',
    ]);
  });

  it('still lists the relief window a month earlier', () => {
    expect(groundsStillOpen('2024-08-01', invoicedOn)).toContain('relief-not-given');
  });

  it('lists everything early on', () => {
    expect(groundsStillOpen('2024-04-10', invoicedOn)).toHaveLength(6);
  });

  it('lists nothing once the longest window has closed', () => {
    expect(groundsStillOpen('2026-01-01', invoicedOn)).toEqual([]);
  });
});

describe('barredReason', () => {
  it('is nothing for a timely claim', () => {
    expect(barredReason(filed(GROUND.WRONG_EVENTS, '2024-05-01'), invoicedOn)).toBeUndefined();
  });

  it('says how late and on what ground', () => {
    expect(barredReason(filed(GROUND.WRONG_EVENTS, '2024-07-05'), invoicedOn)).toBe(
      'filed 1 day after the wrong-events window closed'
    );
  });

  it('pluralises', () => {
    expect(barredReason(filed(GROUND.WRONG_EVENTS, '2024-07-06'), invoicedOn)).toContain('2 days');
  });
});

describe('the decision clock', () => {
  it('runs from the filing date', () => {
    expect(decisionDeadline('2024-04-18')).toBe('2024-06-02');
    expect(DECISION_DAYS).toBe(45);
  });

  it('takes a window of its own', () => {
    expect(decisionDeadline('2024-04-18', 30)).toBe('2024-05-18');
  });

  it('reports an overdue decision', () => {
    const record = filed(GROUND.WRONG_EVENTS, '2024-04-18');
    expect(isDecisionOverdue(record, '2024-06-02')).toBe(false);
    expect(isDecisionOverdue(record, '2024-06-03')).toBe(true);
  });

  it('refuses an absurd decision window', () => {
    expect(() => decisionDeadline('2024-04-18', 0)).toThrow(ValidationError);
  });
});
