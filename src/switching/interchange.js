import { ValidationError } from '../core/errors.js';
import { optional, requireInteger, requireOneOf, requireString } from '../core/guards.js';
import { addHours, formatInstant, parseInstant } from '../time/instant.js';
import { normalizeCarId } from '../equipment/reportingMarks.js';

/**
 * Interchange.
 *
 * A car handed from one carrier to another at a junction changes whose clock it
 * is on, and the two carriers rarely agree about when. The rule that settles it
 * is not "when it moved" but "when it was accepted", and acceptance can be
 * refused: a car offered with a defect goes back to the delivering carrier and
 * the time it spent standing at the junction stays theirs.
 *
 * So the same physical handover is a delivery, a refusal or nothing at all
 * depending on a field the receiving carrier writes afterwards.
 */

export const INTERCHANGE_STATUS = Object.freeze({
  OFFERED: 'offered',
  ACCEPTED: 'accepted',
  REFUSED: 'refused',
  CONSTRUCTIVE: 'constructive',
});

const STATUSES = Object.values(INTERCHANGE_STATUS);

export const REFUSAL_GRACE_HOURS = 24;

export function interchange({
  carId,
  junction,
  deliveringCarrier,
  receivingCarrier,
  offeredAt,
  offsetMinutes = -360,
  status = INTERCHANGE_STATUS.OFFERED,
  settledAt,
  refusalReason,
  graceHours = REFUSAL_GRACE_HOURS,
} = {}) {
  const car = normalizeCarId(requireString(carId, 'carId'));
  requireString(junction, 'junction');
  requireString(deliveringCarrier, 'deliveringCarrier');
  requireString(receivingCarrier, 'receivingCarrier');
  requireOneOf(status, STATUSES, 'status');
  requireInteger(graceHours, 'graceHours', { min: 1, max: 168 });
  if (deliveringCarrier.toUpperCase() === receivingCarrier.toUpperCase()) {
    throw new ValidationError('a car cannot be interchanged with the same carrier', { carId: car });
  }
  const offered =
    typeof offeredAt === 'number'
      ? offeredAt
      : parseInstant(requireString(offeredAt, 'offeredAt'), offsetMinutes);
  const settled =
    settledAt === undefined
      ? undefined
      : typeof settledAt === 'number'
        ? settledAt
        : parseInstant(settledAt, offsetMinutes);
  if (settled !== undefined && settled < offered) {
    throw new ValidationError('a car cannot be settled before it was offered', { carId: car });
  }
  if (status === INTERCHANGE_STATUS.REFUSED && refusalReason === undefined) {
    throw new ValidationError('a refusal has to say why', { carId: car });
  }
  return Object.freeze({
    carId: car,
    junction: junction.trim().toUpperCase(),
    deliveringCarrier: deliveringCarrier.trim().toUpperCase(),
    receivingCarrier: receivingCarrier.trim().toUpperCase(),
    offeredAt: offered,
    settledAt: settled,
    offsetMinutes,
    status,
    refusalReason: optional(refusalReason, (value) => requireString(value, 'refusalReason')),
    graceHours,
    deemedAcceptedAt: addHours(offered, graceHours),
  });
}

/**
 * Who owns the time. An offer nobody answered inside the grace is deemed
 * accepted, which is the clause that stops a receiving carrier leaving cars at
 * a junction indefinitely and calling them somebody else's.
 */
export function responsibleCarrier(record, asOf) {
  if (record.status === INTERCHANGE_STATUS.REFUSED) {
    return record.deliveringCarrier;
  }
  if (record.status === INTERCHANGE_STATUS.ACCEPTED) {
    return record.receivingCarrier;
  }
  const moment = asOf ?? record.settledAt ?? record.deemedAcceptedAt;
  return moment >= record.deemedAcceptedAt ? record.receivingCarrier : record.deliveringCarrier;
}

export function isDeemedAccepted(record, asOf) {
  return (
    record.status === INTERCHANGE_STATUS.OFFERED &&
    (asOf ?? record.deemedAcceptedAt) >= record.deemedAcceptedAt
  );
}

export function timeAtJunctionMinutes(record, asOf) {
  const end = record.settledAt ?? asOf;
  return end === undefined ? 0 : Math.max(0, end - record.offeredAt);
}

export function interchangesForCar(records, carId) {
  const wanted = normalizeCarId(carId);
  return records
    .filter((record) => record.carId === wanted)
    .sort((a, b) => a.offeredAt - b.offeredAt);
}

export function refusals(records) {
  return records.filter((record) => record.status === INTERCHANGE_STATUS.REFUSED);
}

export function describeInterchange(record) {
  return `${record.carId} ${record.deliveringCarrier} to ${record.receivingCarrier} at ${record.junction} ${formatInstant(record.offeredAt, record.offsetMinutes)}`;
}
