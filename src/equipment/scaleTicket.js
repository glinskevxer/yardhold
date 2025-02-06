import { ValidationError } from '../core/errors.js';
import { optional, requireInteger, requireOneOf, requireString } from '../core/guards.js';
import { formatCivilDate, parseCivilDate } from '../time/civil.js';
import { normalizeCarId } from '../equipment/reportingMarks.js';

/**
 * Scale tickets.
 *
 * A weight only counts if the scale that made it was in certificate on the day.
 * An unendorsed weight is not a wrong weight, it is no weight at all, and the
 * difference matters: a wrong weight can be argued about, while no weight sends
 * the car back over the scale and the demurrage clock keeps running while it
 * goes.
 */

export const WEIGHING = Object.freeze({
  TRACK_SCALE: 'track-scale',
  COIL: 'coil',
  AGREED: 'agreed',
  ESTIMATED: 'estimated',
});

const METHODS = Object.values(WEIGHING);

export const OVERLOAD_TOLERANCE_POUNDS = 2000;

export function scaleTicket({
  number,
  carId,
  weighedOn,
  method = WEIGHING.TRACK_SCALE,
  grossPounds,
  tarePounds,
  scaleId,
  certificateExpiresOn,
  weighedBy,
} = {}) {
  requireString(number, 'number');
  const car = normalizeCarId(requireString(carId, 'carId'));
  requireOneOf(method, METHODS, 'method');
  const weighed = parseCivilDate(requireString(weighedOn, 'weighedOn'));
  requireInteger(grossPounds, 'grossPounds', { min: 1, max: 600000 });
  requireInteger(tarePounds, 'tarePounds', { min: 1, max: 200000 });
  if (tarePounds >= grossPounds) {
    throw new ValidationError('a tare cannot weigh as much as the gross', { number });
  }
  const expires = optional(certificateExpiresOn, (value) => parseCivilDate(value));
  if (method === WEIGHING.TRACK_SCALE && (scaleId === undefined || expires === undefined)) {
    throw new ValidationError('a track scale weight has to name the scale and its certificate', {
      number,
    });
  }
  return Object.freeze({
    number,
    carId: car,
    weighedOn: formatCivilDate(weighed),
    method,
    grossPounds,
    tarePounds,
    netPounds: grossPounds - tarePounds,
    scaleId: optional(scaleId, (value) => requireString(value, 'scaleId')),
    certificateExpiresOn: expires === undefined ? undefined : formatCivilDate(expires),
    weighedBy: optional(weighedBy, (value) => requireString(value, 'weighedBy')),
  });
}

/** A weight the carrier will accept for billing. */
export function isAdmissible(ticket) {
  if (ticket.method === WEIGHING.ESTIMATED) {
    return false;
  }
  if (ticket.method !== WEIGHING.TRACK_SCALE) {
    return true;
  }
  return (
    ticket.certificateExpiresOn !== undefined && ticket.certificateExpiresOn >= ticket.weighedOn
  );
}

export function refusalReason(ticket) {
  if (isAdmissible(ticket)) {
    return undefined;
  }
  if (ticket.method === WEIGHING.ESTIMATED) {
    return 'an estimated weight is not a weight';
  }
  return 'the scale was out of certificate on the day';
}

export function overloadPounds(ticket, car, { tolerance = OVERLOAD_TOLERANCE_POUNDS } = {}) {
  if (car?.capacityPounds === undefined) {
    return 0;
  }
  const over = ticket.netPounds - car.capacityPounds;
  return over > tolerance ? over : 0;
}

export function isOverloaded(ticket, car, options) {
  return overloadPounds(ticket, car, options) > 0;
}

export function billableWeight(ticket, car, { minimumPounds = 0 } = {}) {
  if (!isAdmissible(ticket)) {
    return undefined;
  }
  const capacity = car?.capacityPounds;
  const net = capacity === undefined ? ticket.netPounds : Math.min(ticket.netPounds, capacity);
  return Math.max(net, minimumPounds);
}

export function ticketsForCar(tickets, carId) {
  const wanted = normalizeCarId(carId);
  return tickets
    .filter((ticket) => ticket.carId === wanted)
    .sort((a, b) => (a.weighedOn < b.weighedOn ? -1 : a.weighedOn > b.weighedOn ? 1 : 0));
}

export function latestAdmissible(tickets, carId) {
  const admissible = ticketsForCar(tickets, carId).filter(isAdmissible);
  return admissible[admissible.length - 1];
}
