import { requireOneOf } from '../core/guards.js';
import { PLACEMENT } from '../clock/placement.js';
import { EVIDENCE, EXCLUSION } from './exclusion.js';

/**
 * Which relief reaches which car.
 *
 * This is the rule that decides what the other rules are allowed to measure. A
 * plant closure and an embargo are both real, both documented and both cover
 * the same forty hours, and only one of them comes off the count, depending on
 * whether the car was standing inside the gate or outside it when the gate
 * shut.
 */

const RULES = Object.freeze({
  [EXCLUSION.WEATHER]: {
    placements: [PLACEMENT.ACTUAL, PLACEMENT.CONSTRUCTIVE],
    evidence: [EVIDENCE.CARRIER_BULLETIN, EVIDENCE.OFFICE_RECORD],
  },
  [EXCLUSION.EMBARGO]: {
    placements: [PLACEMENT.CONSTRUCTIVE],
    evidence: [EVIDENCE.CARRIER_BULLETIN, EVIDENCE.EVENT_FEED],
  },
  [EXCLUSION.CARRIER_DELAY]: {
    placements: [PLACEMENT.ACTUAL, PLACEMENT.CONSTRUCTIVE],
    evidence: [EVIDENCE.EVENT_FEED, EVIDENCE.CARRIER_BULLETIN, EVIDENCE.OFFICE_RECORD],
  },
  [EXCLUSION.BAD_ORDER]: {
    placements: [PLACEMENT.ACTUAL, PLACEMENT.CONSTRUCTIVE],
    evidence: [EVIDENCE.EVENT_FEED, EVIDENCE.CARRIER_BULLETIN],
    carSpecific: true,
  },
  [EXCLUSION.PLANT_CLOSURE]: {
    placements: [PLACEMENT.CONSTRUCTIVE],
    evidence: [EVIDENCE.CONSIGNEE_NOTICE, EVIDENCE.OFFICE_RECORD],
  },
  [EXCLUSION.STRIKE]: {
    placements: [PLACEMENT.ACTUAL, PLACEMENT.CONSTRUCTIVE],
    evidence: [EVIDENCE.CONSIGNEE_NOTICE, EVIDENCE.CARRIER_BULLETIN],
  },
});

export const REFUSAL = Object.freeze({
  WRONG_PLACEMENT: 'wrong-placement',
  WEAK_EVIDENCE: 'weak-evidence',
  NOT_THIS_CAR: 'not-this-car',
  NOT_HONOURED: 'not-honoured-by-page',
});

export function reliefRule(kind) {
  return RULES[kind];
}

export function reliefKinds() {
  return Object.keys(RULES).sort();
}

export function placementsRelievedBy(kind) {
  return [...(RULES[kind]?.placements ?? [])];
}

/**
 * A page can decline to honour a kind of relief altogether. When it lists
 * nothing it honours all of them, which is what the public tariffs do.
 */
function honoured(page, kind) {
  const honouredKinds = page?.reliefKinds;
  return honouredKinds === undefined || honouredKinds.includes(kind);
}

export function isEligible(record, { placement, page, carId } = {}) {
  requireOneOf(placement, [PLACEMENT.ACTUAL, PLACEMENT.CONSTRUCTIVE, PLACEMENT.NONE], 'placement');
  const rule = RULES[record.kind];
  if (rule === undefined || !honoured(page, record.kind)) {
    return { eligible: false, refusal: REFUSAL.NOT_HONOURED };
  }
  if (!rule.placements.includes(placement)) {
    return { eligible: false, refusal: REFUSAL.WRONG_PLACEMENT };
  }
  if (!rule.evidence.includes(record.evidence)) {
    return { eligible: false, refusal: REFUSAL.WEAK_EVIDENCE };
  }
  if (rule.carSpecific && record.carId === undefined) {
    return { eligible: false, refusal: REFUSAL.NOT_THIS_CAR };
  }
  if (rule.carSpecific && carId !== undefined && record.carId !== carId) {
    return { eligible: false, refusal: REFUSAL.NOT_THIS_CAR };
  }
  return { eligible: true };
}

export function eligibleExclusions(records, context) {
  return records.filter((record) => isEligible(record, context).eligible);
}

export function refusedExclusions(records, context) {
  return records
    .map((record) => ({ record, ...isEligible(record, context) }))
    .filter((entry) => !entry.eligible);
}

export function explainRefusal(refusal) {
  switch (refusal) {
    case REFUSAL.WRONG_PLACEMENT:
      return 'the relief does not reach a car placed this way';
    case REFUSAL.WEAK_EVIDENCE:
      return 'the evidence class is not one this relief accepts';
    case REFUSAL.NOT_THIS_CAR:
      return 'the relief was granted for a different car';
    case REFUSAL.NOT_HONOURED:
      return 'the tariff page does not honour this relief';
    default:
      return 'no reason recorded';
  }
}
