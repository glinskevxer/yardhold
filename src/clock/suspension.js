import { requireArray } from '../core/guards.js';
import { EVIDENCE, EXCLUSION, exclusion } from '../exclusions/exclusion.js';
import { eventKind, resumeCodeFor } from '../events/eventTypes.js';

/**
 * Suspensions reported as events rather than filed as bulletins.
 *
 * A bad order comes down the feed as a BO and a BOR, and nobody files a
 * bulletin for it. Turning those pairs into ordinary exclusions is what lets
 * the eligibility rules apply to them unchanged, which matters because a bad
 * order reaches a car wherever it stands and an embargo does not.
 *
 * A suspension that never closed runs to the cut off. That is deliberate: the
 * alternative is dropping it, and dropping it charges the consignee for a car
 * the carrier admits it could not move.
 */

const SUSPENSION_KIND = Object.freeze({
  BO: EXCLUSION.BAD_ORDER,
  EMB: EXCLUSION.EMBARGO,
  HLD: EXCLUSION.PLANT_CLOSURE,
});

const SUSPENSION_EVIDENCE = Object.freeze({
  BO: EVIDENCE.EVENT_FEED,
  EMB: EVIDENCE.EVENT_FEED,
  HLD: EVIDENCE.CONSIGNEE_NOTICE,
});

export function suspensionsFrom(events, { until, splc, consigneeId } = {}) {
  requireArray(events, 'events');
  const built = [];
  const unclosed = [];
  let open;
  for (const record of events) {
    const kind = eventKind(record.code);
    if (kind.suspends) {
      if (open !== undefined) {
        unclosed.push({ carId: open.carId, code: open.code, at: open.at });
      }
      open = record;
      continue;
    }
    if (!kind.resumes || open === undefined) {
      continue;
    }
    if (resumeCodeFor(open.code) !== record.code) {
      continue;
    }
    built.push(toExclusion(open, record.at, { splc, consigneeId }));
    open = undefined;
  }
  if (open !== undefined) {
    if (until === undefined || until <= open.at) {
      unclosed.push({ carId: open.carId, code: open.code, at: open.at });
    } else {
      built.push(toExclusion(open, until, { splc, consigneeId }));
    }
  }
  return { exclusions: built, unclosed };
}

function toExclusion(start, end, { splc, consigneeId }) {
  const kind = SUSPENSION_KIND[start.code];
  return exclusion({
    kind,
    from: start.at,
    to: end,
    offsetMinutes: start.offsetMinutes,
    evidence: SUSPENSION_EVIDENCE[start.code],
    reference: `event ${start.id}`,
    carId: kind === EXCLUSION.BAD_ORDER ? start.carId : undefined,
    splc: kind === EXCLUSION.BAD_ORDER ? undefined : splc,
    consigneeId: kind === EXCLUSION.PLANT_CLOSURE ? consigneeId : undefined,
  });
}

export function suspendedMinutes(result) {
  return result.exclusions.reduce((sum, record) => sum + (record.span.end - record.span.start), 0);
}

export function hasUnclosedSuspension(result) {
  return result.unclosed.length > 0;
}
