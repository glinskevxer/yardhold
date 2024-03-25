import { ValidationError } from '../core/errors.js';
import { optional, requireInteger, requireOneOf, requireString } from '../core/guards.js';
import { carType } from './carType.js';
import { carInitialAndNumber, formatCarId, isPrivateMark } from './reportingMarks.js';

/**
 * A car as this office knows it. Ownership is not taken on trust from the feed:
 * it is derived from the mark unless the record explicitly overrides it, and an
 * override that contradicts the mark has to say why.
 */

export const OWNERSHIP = Object.freeze({
  RAILROAD: 'railroad',
  PRIVATE: 'private',
  SYSTEM: 'system',
});

const OWNERSHIPS = Object.values(OWNERSHIP);

export function car({
  id,
  designation,
  ownership,
  ownershipReason,
  capacityPounds,
  lightWeightPounds,
  ownerName,
  leaseId,
  heatedSpotRequired = false,
} = {}) {
  const parsed = carInitialAndNumber(requireString(id, 'id'));
  const type = carType(designation);
  const impliedOwnership = isPrivateMark(parsed.mark) ? OWNERSHIP.PRIVATE : OWNERSHIP.RAILROAD;
  const declared =
    ownership === undefined ? impliedOwnership : requireOneOf(ownership, OWNERSHIPS, 'ownership');
  if (declared !== impliedOwnership && declared !== OWNERSHIP.SYSTEM && !ownershipReason) {
    throw new ValidationError('an ownership that contradicts the mark needs a reason', {
      id,
      mark: parsed.mark,
      declared,
      implied: impliedOwnership,
    });
  }
  const capacity = optional(capacityPounds, (value) =>
    requireInteger(value, 'capacityPounds', { min: 1, max: 400000 })
  );
  const light = optional(lightWeightPounds, (value) =>
    requireInteger(value, 'lightWeightPounds', { min: 1, max: 200000 })
  );
  if (capacity !== undefined && light !== undefined && light >= capacity) {
    throw new ValidationError('a car cannot weigh more empty than its capacity', { id });
  }
  return Object.freeze({
    id: formatCarId(parsed),
    mark: parsed.mark,
    number: parsed.number,
    designation: type.designation,
    kind: type.kind,
    ownership: declared,
    ownershipReason: ownershipReason ?? undefined,
    impliedOwnership,
    capacityPounds: capacity,
    lightWeightPounds: light,
    ownerName: optional(ownerName, (value) => requireString(value, 'ownerName')),
    leaseId: optional(leaseId, (value) => requireString(value, 'leaseId')),
    heatedSpotRequired: heatedSpotRequired === true,
  });
}

export function isPrivateCar(record) {
  return record.ownership === OWNERSHIP.PRIVATE;
}

export function isRailroadCar(record) {
  return record.ownership === OWNERSHIP.RAILROAD;
}

/** Railroad cars take demurrage, private cars take storage. Nothing else does. */
export function chargeBook(record) {
  if (isRailroadCar(record)) {
    return 'demurrage';
  }
  if (isPrivateCar(record)) {
    return 'storage';
  }
  return 'none';
}

export function netCapacityPounds(record) {
  if (record.capacityPounds === undefined || record.lightWeightPounds === undefined) {
    return undefined;
  }
  return record.capacityPounds - record.lightWeightPounds;
}

export function describeCar(record) {
  const owner = record.ownerName ? ` ${record.ownerName}` : '';
  return `${record.id} ${record.designation}${owner}`;
}
