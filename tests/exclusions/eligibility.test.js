import { describe, expect, it } from 'vitest';
import {
  REFUSAL,
  eligibleExclusions,
  explainRefusal,
  isEligible,
  placementsRelievedBy,
  refusedExclusions,
  reliefKinds,
  reliefRule,
} from '../../src/exclusions/eligibility.js';
import { EVIDENCE, EXCLUSION, exclusion } from '../../src/exclusions/exclusion.js';
import { PLACEMENT } from '../../src/clock/placement.js';
import { ValidationError } from '../../src/core/errors.js';

const window = { from: '2024-03-07T06:00', to: '2024-03-08T18:00', splc: '412300' };

const weather = exclusion({
  ...window,
  kind: EXCLUSION.WEATHER,
  evidence: EVIDENCE.CARRIER_BULLETIN,
});
const closure = exclusion({
  ...window,
  kind: EXCLUSION.PLANT_CLOSURE,
  evidence: EVIDENCE.CONSIGNEE_NOTICE,
  consigneeId: 'DELTA',
});
const embargo = exclusion({
  ...window,
  kind: EXCLUSION.EMBARGO,
  evidence: EVIDENCE.CARRIER_BULLETIN,
});
const badOrder = exclusion({
  ...window,
  kind: EXCLUSION.BAD_ORDER,
  evidence: EVIDENCE.EVENT_FEED,
  carId: 'BNSF 400123',
});

describe('the catalogue', () => {
  it('lists every relief kind', () => {
    expect(reliefKinds()).toEqual(Object.values(EXCLUSION).sort());
  });

  it('names the placements each one reaches', () => {
    expect(placementsRelievedBy(EXCLUSION.WEATHER).sort()).toEqual(['actual', 'constructive']);
    expect(placementsRelievedBy(EXCLUSION.PLANT_CLOSURE)).toEqual(['constructive']);
    expect(placementsRelievedBy('nothing')).toEqual([]);
  });

  it('exposes the rule itself', () => {
    expect(reliefRule(EXCLUSION.BAD_ORDER).carSpecific).toBe(true);
    expect(reliefRule(EXCLUSION.WEATHER).carSpecific).toBeUndefined();
  });
});

describe('weather reaches a car wherever it stands', () => {
  it('relieves an actual placement', () => {
    expect(isEligible(weather, { placement: PLACEMENT.ACTUAL }).eligible).toBe(true);
  });

  it('relieves a constructive placement', () => {
    expect(isEligible(weather, { placement: PLACEMENT.CONSTRUCTIVE }).eligible).toBe(true);
  });
});

describe('a plant closure only reaches a car outside the gate', () => {
  it('relieves a constructive placement', () => {
    expect(isEligible(closure, { placement: PLACEMENT.CONSTRUCTIVE }).eligible).toBe(true);
  });

  it('does not relieve a car already spotted inside', () => {
    const verdict = isEligible(closure, { placement: PLACEMENT.ACTUAL });
    expect(verdict.eligible).toBe(false);
    expect(verdict.refusal).toBe(REFUSAL.WRONG_PLACEMENT);
  });

  it('is the same window as the weather and still lands differently', () => {
    expect(isEligible(weather, { placement: PLACEMENT.ACTUAL }).eligible).toBe(true);
    expect(isEligible(closure, { placement: PLACEMENT.ACTUAL }).eligible).toBe(false);
  });
});

describe('an embargo only reaches a car the carrier still holds', () => {
  it('relieves a constructive placement', () => {
    expect(isEligible(embargo, { placement: PLACEMENT.CONSTRUCTIVE }).eligible).toBe(true);
  });

  it('does not relieve one already delivered', () => {
    expect(isEligible(embargo, { placement: PLACEMENT.ACTUAL }).refusal).toBe(
      REFUSAL.WRONG_PLACEMENT
    );
  });
});

describe('evidence', () => {
  it('turns down a plant closure the office wrote up as a bulletin', () => {
    const weak = exclusion({
      ...window,
      kind: EXCLUSION.PLANT_CLOSURE,
      evidence: EVIDENCE.CARRIER_BULLETIN,
    });
    expect(isEligible(weak, { placement: PLACEMENT.CONSTRUCTIVE }).refusal).toBe(
      REFUSAL.WEAK_EVIDENCE
    );
  });

  it('accepts an office record for weather', () => {
    const written = exclusion({
      ...window,
      kind: EXCLUSION.WEATHER,
      evidence: EVIDENCE.OFFICE_RECORD,
    });
    expect(isEligible(written, { placement: PLACEMENT.ACTUAL }).eligible).toBe(true);
  });
});

describe('a bad order is about one car', () => {
  it('relieves the car it names', () => {
    expect(
      isEligible(badOrder, { placement: PLACEMENT.ACTUAL, carId: 'BNSF 400123' }).eligible
    ).toBe(true);
  });

  it('does not reach another car', () => {
    expect(isEligible(badOrder, { placement: PLACEMENT.ACTUAL, carId: 'GATX 77' }).refusal).toBe(
      REFUSAL.NOT_THIS_CAR
    );
  });

  it('will not stand as a station wide relief', () => {
    const loose = exclusion({
      ...window,
      kind: EXCLUSION.BAD_ORDER,
      evidence: EVIDENCE.EVENT_FEED,
    });
    expect(isEligible(loose, { placement: PLACEMENT.ACTUAL }).refusal).toBe(REFUSAL.NOT_THIS_CAR);
  });
});

describe('a page can decline a relief outright', () => {
  it('honours everything when it lists nothing', () => {
    expect(isEligible(weather, { placement: PLACEMENT.ACTUAL, page: {} }).eligible).toBe(true);
  });

  it('turns down what it does not list', () => {
    const page = { reliefKinds: [EXCLUSION.CARRIER_DELAY] };
    expect(isEligible(weather, { placement: PLACEMENT.ACTUAL, page }).refusal).toBe(
      REFUSAL.NOT_HONOURED
    );
  });
});

describe('filtering a set', () => {
  const all = [weather, closure, embargo, badOrder];

  it('keeps what reaches an actual placement', () => {
    const kept = eligibleExclusions(all, { placement: PLACEMENT.ACTUAL, carId: 'BNSF 400123' });
    expect(kept.map((record) => record.kind).sort()).toEqual(['bad-order', 'weather']);
  });

  it('keeps more for a constructive placement', () => {
    const kept = eligibleExclusions(all, {
      placement: PLACEMENT.CONSTRUCTIVE,
      carId: 'BNSF 400123',
    });
    expect(kept).toHaveLength(4);
  });

  it('reports what it turned down and why', () => {
    const refused = refusedExclusions(all, { placement: PLACEMENT.ACTUAL, carId: 'BNSF 400123' });
    expect(refused).toHaveLength(2);
    expect(refused.every((entry) => entry.refusal === REFUSAL.WRONG_PLACEMENT)).toBe(true);
  });

  it('refuses a placement it does not know', () => {
    expect(() => isEligible(weather, { placement: 'parked' })).toThrow(ValidationError);
  });
});

describe('explainRefusal', () => {
  it('has words for each refusal', () => {
    expect(explainRefusal(REFUSAL.WRONG_PLACEMENT)).toMatch(/placed this way/);
    expect(explainRefusal(REFUSAL.WEAK_EVIDENCE)).toMatch(/evidence class/);
    expect(explainRefusal(REFUSAL.NOT_THIS_CAR)).toMatch(/different car/);
    expect(explainRefusal(REFUSAL.NOT_HONOURED)).toMatch(/tariff page/);
    expect(explainRefusal('something else')).toBe('no reason recorded');
  });
});
