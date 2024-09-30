import { requireObject } from '../core/guards.js';
import { subtract } from '../core/money.js';
import { CLAIM_STATUS, GROUND } from './claim.js';

/**
 * Deciding a claim.
 *
 * A recomputation is only allowed to move the inputs the ground opened. This is
 * the whole discipline of the thing: a consignee who files on the weather and
 * turns out to have released the car a day early gets nothing for it, because
 * the recomputation under a weather claim is not allowed to touch the event
 * stream. They can file again on the right ground while the time limit holds.
 */

const REOPENS = Object.freeze({
  [GROUND.WRONG_EVENTS]: ['events'],
  [GROUND.RELIEF_NOT_GIVEN]: ['exclusions'],
  [GROUND.WRONG_TARIFF]: ['page'],
  [GROUND.WRONG_PARTY]: ['consigneeId'],
  [GROUND.ARITHMETIC]: [],
  [GROUND.BUNCHING]: ['orders', 'exclusions'],
});

export function reopenableInputs(ground) {
  return [...(REOPENS[ground] ?? [])];
}

export function mayReopen(ground, input) {
  return reopenableInputs(ground).includes(input);
}

/** Drop every substitution the ground does not open, and say what was dropped. */
export function filterSubstitutions(ground, substitutions = {}) {
  const allowed = {};
  const refused = [];
  for (const [key, value] of Object.entries(substitutions)) {
    if (mayReopen(ground, key)) {
      allowed[key] = value;
    } else {
      refused.push(key);
    }
  }
  return { allowed, refused };
}

export function adjudicate(record, { originalTotal, revisedTotal } = {}) {
  requireObject(record, 'claim');
  if (!Number.isInteger(originalTotal) || !Number.isInteger(revisedTotal)) {
    return { status: CLAIM_STATUS.DENIED, allowedAmount: 0, reason: 'nothing was recomputed' };
  }
  const difference = subtract(originalTotal, revisedTotal);
  if (difference <= 0) {
    return {
      status: CLAIM_STATUS.DENIED,
      allowedAmount: 0,
      difference,
      reason: 'the recomputation did not reduce the charge',
    };
  }
  if (difference >= record.amountClaimed) {
    return {
      status: CLAIM_STATUS.ALLOWED,
      allowedAmount: record.amountClaimed,
      difference,
      reason: 'the recomputation covered the claim in full',
    };
  }
  return {
    status: CLAIM_STATUS.ALLOWED_IN_PART,
    allowedAmount: difference,
    difference,
    reason: 'the recomputation reduced the charge by less than the claim',
  };
}

export function adjudicateWithSubstitutions(
  record,
  { originalTotal, recompute, substitutions } = {}
) {
  const { allowed, refused } = filterSubstitutions(record.ground, substitutions);
  const revisedTotal = recompute(allowed);
  const decision = adjudicate(record, { originalTotal, revisedTotal });
  return { ...decision, appliedInputs: Object.keys(allowed).sort(), refusedInputs: refused.sort() };
}

export function totalAllowed(decisions) {
  return decisions.reduce((sum, decision) => sum + decision.allowedAmount, 0);
}
