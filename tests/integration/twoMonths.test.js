import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loadConfig.js';
import { ingestCsv } from '../../src/io/ingestEvents.js';
import { assessMonth, assessmentsFor } from '../../src/assessment/runMonth.js';
import { creditLedger } from '../../src/average/credits.js';
import { runPeriods } from '../../src/average/reconcile.js';
import { averageAgreement } from '../../src/average/agreement.js';
import { periodRegister } from '../../src/settlement/periodClose.js';
import { routeLateEvents } from '../../src/settlement/periodClose.js';
import { periodSeries, direction, DIRECTION } from '../../src/reporting/trend.js';
import { SERVICE } from '../../src/tariff/freeTimeTable.js';

/**
 * Two months back to back, which is the smallest run that exercises the things
 * a single month cannot: credits carrying forward, a car standing across the
 * boundary, and a late event arriving after the first month was closed.
 */

const page = {
  id: 'DEM-4000',
  carrier: 'BNSF',
  notificationRequired: false,
  averageAgreementAllowed: true,
  ladder: [{ fromDay: 1, rate: '150.00' }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 2 }],
};

const world = loadConfig({
  settings: { years: [2024] },
  stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
  tracks: [
    { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 8, consigneeId: 'DELTA' },
  ],
  parties: [
    {
      id: 'DELTA',
      name: 'Delta Chemical',
      noticeAddress: 'a@b.example',
      averageAgreementId: 'AVG-1',
    },
  ],
  agreements: [
    {
      id: 'AVG-1',
      consigneeId: 'DELTA',
      from: '2024-01-01',
      to: '2024-12-31',
      carryOver: true,
      creditCapPerCar: 4,
    },
  ],
  tariffs: [{ page, effectiveFrom: '2024-01-01' }],
});

const march = ingestCsv(
  [
    'car,event,event_time,track',
    'BNSF 1,AP,2024-03-04T00:00,IT-9',
    'BNSF 1,REL,2024-03-04T06:00,IT-9',
    'BNSF 2,AP,2024-03-05T00:00,IT-9',
    'BNSF 2,REL,2024-03-05T06:00,IT-9',
    'BNSF 3,AP,2024-03-06T00:00,IT-9',
    'BNSF 3,REL,2024-03-06T06:00,IT-9',
    'BNSF 9,AP,2024-03-29T00:00,IT-9',
    '',
  ].join('\n')
);

const april = ingestCsv(
  [
    'car,event,event_time,track',
    'BNSF 9,REL,2024-04-04T00:00,IT-9',
    'BNSF 4,AP,2024-04-05T00:00,IT-9',
    'BNSF 4,REL,2024-04-12T00:00,IT-9',
    '',
  ].join('\n')
);

const marchResult = assessMonth(world, march.events, { period: '202403', carrier: 'BNSF' });
const aprilResult = assessMonth(world, [...march.events, ...april.events], {
  period: '202404',
  carrier: 'BNSF',
});

describe('a car standing across the month end', () => {
  it('is billed to the cut off in March', () => {
    const standing = marchResult.assessments.find((entry) => entry.carId === 'BNSF 9');
    expect(standing.chargeableDays).toBe(1);
    expect(standing.detentions[0].open).toBe(false);
  });

  it('is billed again in April from its own placement', () => {
    const standing = aprilResult.assessments.find((entry) => entry.carId === 'BNSF 9');
    expect(standing.chargeableDays).toBeGreaterThan(1);
  });
});

describe('credits carrying across the boundary', () => {
  const agreement = averageAgreement({
    id: 'AVG-1',
    consigneeId: 'DELTA',
    from: '2024-01-01',
    to: '2024-12-31',
    carryOver: true,
    creditCapPerCar: 4,
  });

  const ledgers = new Map([
    ['202403', creditLedger(assessmentsFor(marchResult, 'DELTA'), agreement)],
    [
      '202404',
      creditLedger(
        aprilResult.assessments.filter((entry) => entry.carId === 'BNSF 4'),
        agreement
      ),
    ],
  ]);

  it('earns credits on the quick March cars', () => {
    const settlements = runPeriods(ledgers, agreement);
    expect(settlements[0].earnedCredits).toBeGreaterThan(0);
  });

  it('carries what is left into April', () => {
    const settlements = runPeriods(ledgers, agreement);
    expect(settlements[0].carriedOut).toBe(settlements[1].openingCredits);
  });

  it('spends the carried credits against the April debits', () => {
    const settlements = runPeriods(ledgers, agreement);
    expect(settlements[1].offsetDebits).toBeGreaterThan(0);
    expect(settlements[1].billableDebits).toBeLessThan(settlements[1].debits);
  });

  it('bills April in full when the agreement does not carry', () => {
    const strict = averageAgreement({
      id: 'AVG-2',
      consigneeId: 'DELTA',
      from: '2024-01-01',
      to: '2024-12-31',
      creditCapPerCar: 4,
    });
    const settlements = runPeriods(ledgers, strict);
    expect(settlements[1].openingCredits).toBe(0);
    expect(settlements[1].billableDebits).toBe(settlements[1].debits);
  });
});

describe('a late March event arriving after the close', () => {
  const register = periodRegister();
  register.close('202403', { closedOn: '2024-04-10', closedBy: 'clerk' });

  const late = ingestCsv('car,event,event_time,track\nBNSF 5,AP,2024-03-28T00:00,IT-9\n');

  it('is held rather than assessed into the closed month', () => {
    const routed = routeLateEvents(register, late.events);
    expect(routed.accepted).toEqual([]);
    expect(routed.held[0].period).toBe('202403');
  });

  it('goes through once the month is reopened', () => {
    register.reopen('202403', 'carrier sent March events on 12 April');
    expect(routeLateEvents(register, late.events).accepted).toHaveLength(1);
  });

  it('lets April events through the whole time', () => {
    expect(routeLateEvents(register, april.events).accepted).toHaveLength(april.events.length);
  });
});

describe('the two months as a series', () => {
  const series = periodSeries(
    new Map([
      ['202403', marchResult.assessments],
      ['202404', aprilResult.assessments],
    ])
  );

  it('reports both months in order', () => {
    expect(series.map((row) => row.period)).toEqual(['202403', '202404']);
  });

  it('is not long enough to call a trend', () => {
    expect(direction(series)).toBe(DIRECTION.FLAT);
  });

  it('reports a charge per car for each', () => {
    expect(series.every((row) => row.perCar >= 0)).toBe(true);
  });
});
