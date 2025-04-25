import { describe, expect, it } from 'vitest';
import {
  daysAdded,
  daysRemoved,
  differenceByDay,
  recomputeCar,
  recomputeForClaim,
  summariseRecompute,
} from '../../src/assessment/recompute.js';
import { assessCar } from '../../src/assessment/assess.js';
import { CLAIM_STATUS, GROUND, claim } from '../../src/disputes/claim.js';
import { trackEvent } from '../../src/events/event.js';
import { TRACK_ROLE, trackBook } from '../../src/site/track.js';
import { tariff } from '../../src/tariff/tariff.js';
import { SERVICE } from '../../src/tariff/freeTimeTable.js';
import { serviceCalendar } from '../../src/time/serviceCalendar.js';
import { EVIDENCE, EXCLUSION, exclusion } from '../../src/exclusions/exclusion.js';
import { ValidationError } from '../../src/core/errors.js';

const tracks = trackBook([
  { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
  { id: 'HT-1', splc: '412300', name: 'North hold', role: TRACK_ROLE.HOLD, capacityCars: 20 },
]);

const calendar = serviceCalendar({ id: 'MEM', years: [2024] });

const page = tariff({
  id: 'DEM-4000',
  carrier: 'BNSF',
  notificationRequired: false,
  ladder: [{ fromDay: 1, rate: '150.00' }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
});

const cheaper = tariff({
  id: 'CON-DELTA',
  carrier: 'BNSF',
  notificationRequired: false,
  ladder: [{ fromDay: 1, rate: '95.00' }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
});

const events = [
  trackEvent({ carId: 'BNSF 400123', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' }),
  trackEvent({ carId: 'BNSF 400123', code: 'REL', at: '2024-03-08T00:00' }),
];

const shorter = [
  trackEvent({ carId: 'BNSF 400123', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' }),
  trackEvent({ carId: 'BNSF 400123', code: 'REL', at: '2024-03-07T00:00' }),
];

const storm = exclusion({
  kind: EXCLUSION.WEATHER,
  from: '2024-03-06T00:00',
  to: '2024-03-07T00:00',
  splc: '412300',
  evidence: EVIDENCE.CARRIER_BULLETIN,
});

const query = { service: SERVICE.UNLOADING };
const inputs = { carId: 'BNSF 400123', events, page, calendar, trackBook: tracks, query };
const original = { ...assessCar(inputs), ...inputs, exclusions: [] };

const filed = (ground) =>
  claim({
    sequence: 1,
    period: '202404',
    invoiceNumber: 'INV-202403-00012',
    consigneeId: 'DELTA',
    ground,
    filedOn: '2024-04-18',
    amountClaimed: 15000,
    evidence: ['x'],
  });

describe('recomputeCar', () => {
  it('reproduces the original with no substitutions', () => {
    expect(recomputeCar(original).total).toBe(original.total);
  });

  it('takes a different event stream', () => {
    expect(recomputeCar(original, { events: shorter }).chargeableDays).toBe(2);
  });

  it('takes a different page', () => {
    expect(recomputeCar(original, { page: cheaper }).total).toBe(3 * 9500);
  });

  it('takes different relief', () => {
    expect(recomputeCar(original, { exclusions: [storm] }).chargeableDays).toBe(2);
  });

  it('needs the original', () => {
    expect(() => recomputeCar(undefined)).toThrow(ValidationError);
  });
});

describe('recomputeForClaim', () => {
  it('allows a relief claim on relief', () => {
    const decision = recomputeForClaim(filed(GROUND.RELIEF_NOT_GIVEN), original, {
      exclusions: [storm],
    });
    expect(decision.status).toBe(CLAIM_STATUS.ALLOWED);
    expect(decision.appliedInputs).toEqual(['exclusions']);
  });

  it('refuses an event substitution on a relief claim', () => {
    const decision = recomputeForClaim(filed(GROUND.RELIEF_NOT_GIVEN), original, {
      events: shorter,
    });
    expect(decision.status).toBe(CLAIM_STATUS.DENIED);
    expect(decision.refusedInputs).toEqual(['events']);
  });

  it('allows the same substitution once the ground is right', () => {
    const decision = recomputeForClaim(filed(GROUND.WRONG_EVENTS), original, { events: shorter });
    expect(decision.status).toBe(CLAIM_STATUS.ALLOWED);
  });

  it('allows in part when the recomputation fell short of the claim', () => {
    const big = claim({
      sequence: 1,
      period: '202404',
      invoiceNumber: 'INV-202403-00012',
      consigneeId: 'DELTA',
      ground: GROUND.WRONG_EVENTS,
      filedOn: '2024-04-18',
      amountClaimed: 90000,
      evidence: ['x'],
    });
    const decision = recomputeForClaim(big, original, { events: shorter });
    expect(decision.status).toBe(CLAIM_STATUS.ALLOWED_IN_PART);
    expect(decision.allowedAmount).toBe(15000);
  });

  it('carries the recomputed assessment back', () => {
    const decision = recomputeForClaim(filed(GROUND.WRONG_EVENTS), original, { events: shorter });
    expect(decision.revised.chargeableDays).toBe(2);
  });
});

describe('reading the difference', () => {
  const revised = recomputeCar(original, { exclusions: [storm] });

  it('lists only the days that moved', () => {
    const rows = differenceByDay(original, revised);
    expect(rows).toHaveLength(1);
    expect(rows.every((row) => row.before !== row.after)).toBe(true);
  });

  it('names the day that came off', () => {
    expect(daysRemoved(original, revised)).toEqual(['2024-03-06']);
  });

  it('leaves a day that was charged at the same rate out of the difference', () => {
    expect(differenceByDay(original, revised).map((row) => row.date)).not.toContain('2024-03-07');
  });

  it('names nothing added', () => {
    expect(daysAdded(original, revised)).toEqual([]);
  });

  it('names a day added when the recomputation went the other way', () => {
    const longer = recomputeCar(original, {
      events: [
        trackEvent({ carId: 'BNSF 400123', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' }),
        trackEvent({ carId: 'BNSF 400123', code: 'REL', at: '2024-03-10T00:00' }),
      ],
    });
    expect(daysAdded(original, longer)).toEqual(['2024-03-08', '2024-03-09']);
  });

  it('summarises the whole recomputation', () => {
    expect(summariseRecompute(original, revised)).toEqual({
      daysBefore: 3,
      daysAfter: 2,
      removed: ['2024-03-06'],
      added: [],
      difference: -15000,
    });
  });

  it('reports nothing when nothing moved', () => {
    expect(differenceByDay(original, original)).toEqual([]);
  });
});
