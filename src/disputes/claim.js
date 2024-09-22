import { ValidationError } from '../core/errors.js';
import { optional, requireArray, requireOneOf, requireString } from '../core/guards.js';
import { referenceNumber } from '../core/ids.js';
import { formatCivilDate, parseCivilDate } from '../time/civil.js';

/**
 * A claim against an invoice.
 *
 * The ground a claim is filed on decides what may be reopened. A claim that the
 * car was released earlier than reported reopens the event stream. A claim that
 * the weather closed the road reopens the relief. A claim that the rate is
 * wrong reopens the tariff selection and nothing else. A consignee who files on
 * the wrong ground and turns out to be right about something else has still
 * filed the wrong claim, which is why the ground is a field and not a note.
 */

export const GROUND = Object.freeze({
  WRONG_EVENTS: 'wrong-events',
  RELIEF_NOT_GIVEN: 'relief-not-given',
  WRONG_TARIFF: 'wrong-tariff',
  WRONG_PARTY: 'wrong-party',
  ARITHMETIC: 'arithmetic',
  BUNCHING: 'bunching',
});

const GROUNDS = Object.values(GROUND);

export const CLAIM_STATUS = Object.freeze({
  FILED: 'filed',
  ALLOWED: 'allowed',
  ALLOWED_IN_PART: 'allowed-in-part',
  DENIED: 'denied',
  WITHDRAWN: 'withdrawn',
});

const STATUSES = Object.values(CLAIM_STATUS);

export function claim({
  sequence,
  period,
  invoiceNumber,
  consigneeId,
  ground,
  filedOn,
  cars = [],
  amountClaimed,
  narrative,
  evidence = [],
  status = CLAIM_STATUS.FILED,
} = {}) {
  requireString(period, 'period');
  requireString(invoiceNumber, 'invoiceNumber');
  requireString(consigneeId, 'consigneeId');
  requireOneOf(ground, GROUNDS, 'ground');
  requireOneOf(status, STATUSES, 'status');
  requireArray(cars, 'cars');
  requireArray(evidence, 'evidence');
  const filed = parseCivilDate(requireString(filedOn, 'filedOn'));
  if (typeof amountClaimed !== 'number' || !Number.isInteger(amountClaimed) || amountClaimed <= 0) {
    throw new ValidationError('a claim has to name a whole cent amount above zero', {
      invoiceNumber,
    });
  }
  if (ground !== GROUND.ARITHMETIC && evidence.length === 0) {
    throw new ValidationError('every ground but arithmetic needs evidence', { ground });
  }
  return Object.freeze({
    number: referenceNumber('CLM', period, sequence),
    period,
    invoiceNumber,
    consigneeId: consigneeId.trim().toUpperCase(),
    ground,
    filedOn: formatCivilDate(filed),
    cars: Object.freeze([...cars]),
    amountClaimed,
    narrative: optional(narrative, (value) => requireString(value, 'narrative')),
    evidence: Object.freeze([...evidence]),
    status,
  });
}

export function withClaimStatus(record, status) {
  requireOneOf(status, STATUSES, 'status');
  if (record.status === CLAIM_STATUS.WITHDRAWN) {
    throw new ValidationError('a withdrawn claim cannot be reopened', { number: record.number });
  }
  return Object.freeze({ ...record, status });
}

export function isDecided(record) {
  return record.status !== CLAIM_STATUS.FILED;
}

export function isAllowed(record) {
  return record.status === CLAIM_STATUS.ALLOWED || record.status === CLAIM_STATUS.ALLOWED_IN_PART;
}

export function claimsAgainst(claims, invoiceNumber) {
  return claims.filter((record) => record.invoiceNumber === invoiceNumber);
}

export function openClaims(claims) {
  return claims.filter((record) => !isDecided(record));
}

export function describeClaim(record) {
  return `${record.number} against ${record.invoiceNumber} on ${record.ground} for ${record.amountClaimed}`;
}
