import { ValidationError } from '../core/errors.js';
import { optional, requireOneOf, requireString } from '../core/guards.js';
import { fingerprint } from '../core/ids.js';
import { formatInstant, parseInstant } from '../time/instant.js';
import { durationMinutes, period } from '../time/period.js';

/**
 * An exclusion is a stretch of time that does not count against free time. What
 * it is called decides more than how long it lasted:
 *
 *   weather        an act of God, relieves whoever was holding the car
 *   embargo        the carrier would not move it
 *   carrier-delay  the carrier failed to do something it had undertaken to do
 *   bad-order      the car itself was unfit
 *   plant-closure  the consignee shut the gate
 *
 * The last one is the interesting case. A plant that shuts does not relieve a
 * car already spotted inside it, because nothing stopped the consignee
 * unloading. It does relieve a car standing on the carrier's hold track, since
 * the consignee could not have taken it in any case.
 */

export const EXCLUSION = Object.freeze({
  WEATHER: 'weather',
  EMBARGO: 'embargo',
  CARRIER_DELAY: 'carrier-delay',
  BAD_ORDER: 'bad-order',
  PLANT_CLOSURE: 'plant-closure',
  STRIKE: 'strike',
});

const KINDS = Object.values(EXCLUSION);

export const EVIDENCE = Object.freeze({
  CARRIER_BULLETIN: 'carrier-bulletin',
  EVENT_FEED: 'event-feed',
  CONSIGNEE_NOTICE: 'consignee-notice',
  OFFICE_RECORD: 'office-record',
});

const EVIDENCES = Object.values(EVIDENCE);

export function exclusion({
  kind,
  from,
  to,
  offsetMinutes = -360,
  evidence = EVIDENCE.OFFICE_RECORD,
  reference,
  splc,
  carId,
  consigneeId,
  note,
} = {}) {
  requireOneOf(kind, KINDS, 'kind');
  requireOneOf(evidence, EVIDENCES, 'evidence');
  const start =
    typeof from === 'number' ? from : parseInstant(requireString(from, 'from'), offsetMinutes);
  const end = typeof to === 'number' ? to : parseInstant(requireString(to, 'to'), offsetMinutes);
  if (end <= start) {
    throw new ValidationError('an exclusion has to cover some time', { kind, from, to });
  }
  if (splc === undefined && carId === undefined && consigneeId === undefined) {
    throw new ValidationError('an exclusion has to say what it applies to', { kind });
  }
  const record = {
    kind,
    span: period(start, end),
    offsetMinutes,
    evidence,
    reference: optional(reference, (value) => requireString(value, 'reference')),
    splc: optional(splc, (value) => requireString(value, 'splc')),
    carId: optional(carId, (value) => requireString(value, 'carId')),
    consigneeId: optional(consigneeId, (value) =>
      requireString(value, 'consigneeId').toUpperCase()
    ),
    note,
  };
  record.id = fingerprint([record.kind, start, end, record.splc, record.carId, record.consigneeId]);
  return Object.freeze(record);
}

export function exclusionMinutes(record) {
  return durationMinutes(record.span);
}

export function isStationWide(record) {
  return record.carId === undefined && record.consigneeId === undefined;
}

export function appliesToCar(record, carId) {
  return record.carId === undefined || record.carId === carId;
}

export function appliesToConsignee(record, consigneeId) {
  if (record.consigneeId === undefined) {
    return true;
  }
  return consigneeId !== undefined && record.consigneeId === consigneeId.toUpperCase();
}

export function appliesToStation(record, splc) {
  return record.splc === undefined || record.splc === splc;
}

export function describeExclusion(record) {
  const reference = record.reference === undefined ? '' : ` (${record.reference})`;
  return `${record.kind} ${formatInstant(record.span.start, record.offsetMinutes)} to ${formatInstant(
    record.span.end,
    record.offsetMinutes
  )}${reference}`;
}
