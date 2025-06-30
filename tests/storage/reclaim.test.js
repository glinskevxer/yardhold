import { describe, expect, it } from 'vitest';
import {
  RECLAIM_BASIS,
  carrierCausedHours,
  reclaim,
  reclaimAll,
  reclaimTerms,
  reclaimableHours,
  reclaimedShare,
  reliefIsCarrierCaused,
} from '../../src/storage/reclaim.js';
import { EVIDENCE, EXCLUSION, exclusion } from '../../src/exclusions/exclusion.js';
import { ValidationError } from '../../src/core/errors.js';

const terms = reclaimTerms();
const hireCharge = { total: 24000 };

const badOrder = exclusion({
  kind: EXCLUSION.BAD_ORDER,
  from: '2024-03-05T00:00',
  to: '2024-03-06T00:00',
  carId: 'BNSF 400123',
  evidence: EVIDENCE.EVENT_FEED,
});

const closure = exclusion({
  kind: EXCLUSION.PLANT_CLOSURE,
  from: '2024-03-05T00:00',
  to: '2024-03-06T00:00',
  splc: '412300',
  consigneeId: 'DELTA',
  evidence: EVIDENCE.CONSIGNEE_NOTICE,
});

describe('reclaimTerms', () => {
  it('defaults to the chargeable hours at the whole rate', () => {
    expect(terms.basis).toBe(RECLAIM_BASIS.CHARGEABLE_HOURS);
    expect(terms.sharePercent).toBe(100);
  });

  it('refuses a share that is not a whole percentage', () => {
    expect(() => reclaimTerms({ sharePercent: 101 })).toThrow(/whole percentage/);
    expect(() => reclaimTerms({ sharePercent: 12.5 })).toThrow(/whole percentage/);
  });

  it('refuses a cap that is not whole cents', () => {
    expect(() => reclaimTerms({ cap: 12.5 })).toThrow(/whole cent/);
    expect(() => reclaimTerms({ cap: -1 })).toThrow(/whole cent/);
  });

  it('refuses a basis it does not know', () => {
    expect(() => reclaimTerms({ basis: 'guesswork' })).toThrow(ValidationError);
  });
});

describe('which relief the carrier caused itself', () => {
  it('counts a bad order and an embargo', () => {
    expect(reliefIsCarrierCaused(badOrder)).toBe(true);
  });

  it('does not count a plant closure', () => {
    expect(reliefIsCarrierCaused(closure)).toBe(false);
  });

  it('adds the carrier caused hours up', () => {
    expect(carrierCausedHours([badOrder, closure])).toBe(24);
    expect(carrierCausedHours([])).toBe(0);
  });

  it('refuses a non array', () => {
    expect(() => carrierCausedHours('nope')).toThrow(ValidationError);
  });
});

describe('reclaimableHours', () => {
  it('is the chargeable hours by default', () => {
    expect(reclaimableHours(terms, { heldHours: 120, chargeableHours: 72 })).toBe(72);
  });

  it('never exceeds the hours actually held', () => {
    expect(reclaimableHours(terms, { heldHours: 48, chargeableHours: 72 })).toBe(48);
  });

  it('takes every held hour on the wider basis', () => {
    const wide = reclaimTerms({ basis: RECLAIM_BASIS.ALL_HELD_HOURS });
    expect(reclaimableHours(wide, { heldHours: 120, chargeableHours: 72 })).toBe(120);
  });

  it('takes the carrier caused hours off either way', () => {
    expect(reclaimableHours(terms, { heldHours: 120, chargeableHours: 72, reliefHours: 60 })).toBe(
      60
    );
    const wide = reclaimTerms({ basis: RECLAIM_BASIS.ALL_HELD_HOURS });
    expect(reclaimableHours(wide, { heldHours: 120, chargeableHours: 72, reliefHours: 60 })).toBe(
      60
    );
  });

  it('never goes below nothing', () => {
    expect(reclaimableHours(terms, { heldHours: 10, chargeableHours: 10, reliefHours: 50 })).toBe(
      0
    );
  });
});

describe('reclaim', () => {
  const entry = { carId: 'BNSF 400123', hireCharge, heldHours: 120, chargeableHours: 72 };

  it('reclaims the hire in proportion to the hours', () => {
    const line = reclaim(terms, entry);
    expect(line.hours).toBe(72);
    expect(line.amount).toBe(14400);
    expect(line.reclaimable).toBe(true);
  });

  it('takes only the share the terms allow', () => {
    expect(reclaim(reclaimTerms({ sharePercent: 50 }), entry).amount).toBe(7200);
  });

  it('holds the reclaim to a cap', () => {
    const line = reclaim(reclaimTerms({ cap: 10000 }), entry);
    expect(line.amount).toBe(10000);
    expect(line.cappedAt).toBe(10000);
  });

  it('leaves the cap alone when the reclaim is under it', () => {
    expect(reclaim(reclaimTerms({ cap: 90000 }), entry).cappedAt).toBeUndefined();
  });

  it('takes the bad order hours off the reclaim', () => {
    const line = reclaim(terms, { ...entry, exclusions: [badOrder] });
    expect(line.reliefHours).toBe(24);
    expect(line.hours).toBe(72);
  });

  it('does not take a plant closure off it', () => {
    const withClosure = reclaim(terms, { ...entry, exclusions: [closure] });
    const bare = reclaim(terms, entry);
    expect(withClosure.hours).toBe(bare.hours);
  });

  it('reclaims nothing on a private car unless the terms say so', () => {
    const line = reclaim(terms, { ...entry, car: { ownership: 'private' } });
    expect(line.reclaimable).toBe(false);
    expect(line.why).toBe('the car is not on hire');
    const wide = reclaimTerms({ appliesToPrivateCars: true });
    expect(reclaim(wide, { ...entry, car: { ownership: 'private' } }).reclaimable).toBe(true);
  });

  it('reclaims nothing when there are no hours to reclaim', () => {
    const line = reclaim(terms, { ...entry, chargeableHours: 0 });
    expect(line.reclaimable).toBe(false);
    expect(line.why).toBe('no reclaimable hours');
  });

  it('needs a car', () => {
    expect(() => reclaim(terms, { hireCharge, heldHours: 1, chargeableHours: 1 })).toThrow(
      ValidationError
    );
  });
});

describe('reclaimAll', () => {
  it('runs a set and totals it', () => {
    const result = reclaimAll(terms, [
      { carId: 'BNSF 400123', hireCharge, heldHours: 120, chargeableHours: 72 },
      { carId: 'UP 3', hireCharge, heldHours: 48, chargeableHours: 0 },
    ]);
    expect(result.lines).toHaveLength(2);
    expect(result.total).toBe(14400);
  });

  it('reports what share of the hire came back', () => {
    const result = reclaimAll(terms, [
      { carId: 'BNSF 400123', hireCharge, heldHours: 120, chargeableHours: 72 },
    ]);
    expect(reclaimedShare(result, 24000)).toBe(0.6);
    expect(reclaimedShare(result, 0)).toBe(0);
  });

  it('refuses a non array', () => {
    expect(() => reclaimAll(terms, 'nope')).toThrow(ValidationError);
  });
});
