import { ValidationError } from '../core/errors.js';
import { keyedBook } from '../core/keyedBook.js';
import { requireArray, requireInteger, requireOneOf, requireString } from '../core/guards.js';

/**
 * Tracks. The distinction that matters for billing is who owns the track and
 * whether it is inside the plant: a car sitting on carrier owned hold track
 * because the industry track is full is constructively placed, and a car on the
 * industry track is actually placed. Same car, same yard, different clock.
 */

export const TRACK_ROLE = Object.freeze({
  INDUSTRY: 'industry',
  HOLD: 'hold',
  INTERCHANGE: 'interchange',
  REPAIR: 'repair',
});

const ROLES = Object.values(TRACK_ROLE);

export function track({
  id,
  splc,
  name,
  role = TRACK_ROLE.INDUSTRY,
  capacityCars,
  spots = [],
  ownedByCarrier,
  consigneeId,
  heated = false,
} = {}) {
  requireString(id, 'id');
  requireString(splc, 'splc');
  requireString(name, 'name');
  requireOneOf(role, ROLES, 'role');
  requireInteger(capacityCars, 'capacityCars', { min: 1, max: 400 });
  requireArray(spots, 'spots');
  const spotNames = spots.map((spot) => requireString(spot, 'spot').trim().toUpperCase());
  if (new Set(spotNames).size !== spotNames.length) {
    throw new ValidationError('a track cannot list the same spot twice', { id });
  }
  if (spotNames.length > capacityCars) {
    throw new ValidationError('a track cannot have more spots than car lengths', { id });
  }
  const carrierOwned =
    ownedByCarrier === undefined ? role !== TRACK_ROLE.INDUSTRY : ownedByCarrier === true;
  if (role === TRACK_ROLE.INDUSTRY && consigneeId === undefined) {
    throw new ValidationError('an industry track has to name its consignee', { id });
  }
  return Object.freeze({
    id,
    splc,
    name: name.trim(),
    role,
    capacityCars,
    spots: Object.freeze(spotNames),
    ownedByCarrier: carrierOwned,
    consigneeId: consigneeId === undefined ? undefined : requireString(consigneeId, 'consigneeId'),
    heated: heated === true,
  });
}

/** Placement on an industry track is actual; anywhere else it is at best constructive. */
export function supportsActualPlacement(record) {
  return record.role === TRACK_ROLE.INDUSTRY;
}

export function isHoldTrack(record) {
  return record.role === TRACK_ROLE.HOLD;
}

export function hasSpot(record, spot) {
  if (record.spots.length === 0) {
    return true;
  }
  return record.spots.includes(requireString(spot, 'spot').trim().toUpperCase());
}

export function trackBook(tracks = []) {
  const book = keyedBook({
    label: 'track',
    records: tracks,
    keyOf: (record) => record.id,
    build: (record) => (record.capacityCars !== undefined && record.spots ? record : track(record)),
  });
  return {
    get size() {
      return book.size;
    },
    has: book.has,
    get: book.get,
    find: book.find,
    all: book.all,
    atStation(splc) {
      return book.filter((entry) => entry.splc === splc);
    },
    ofRole(role) {
      requireOneOf(role, ROLES, 'role');
      return book.filter((entry) => entry.role === role);
    },
    forConsignee(consigneeId) {
      return book.filter((entry) => entry.consigneeId === consigneeId);
    },
    totalCapacity(splc) {
      return book
        .filter((entry) => splc === undefined || entry.splc === splc)
        .reduce((sum, entry) => sum + entry.capacityCars, 0);
    },
  };
}
