import { NotFoundError, ValidationError } from '../core/errors.js';
import { requireString } from '../core/guards.js';

/**
 * AAR mechanical designations, cut down to the classes that move over this
 * track. The designation carries more than a shape: whether a car can be
 * spotted at more than one door, whether it needs a heated spot, and whether
 * the tariff has a separate free time table for it all key off this.
 */

const TYPES = new Map([
  ['XM', { kind: 'boxcar', name: 'general service boxcar', doors: 2, covered: true }],
  ['XP', { kind: 'boxcar', name: 'special service boxcar', doors: 2, covered: true }],
  ['XL', { kind: 'boxcar', name: 'insulated boxcar', doors: 2, covered: true }],
  [
    'RB',
    { kind: 'refrigerated', name: 'insulated bunkerless refrigerator', doors: 2, covered: true },
  ],
  ['RP', { kind: 'refrigerated', name: 'mechanical refrigerator', doors: 2, covered: true }],
  ['GB', { kind: 'gondola', name: 'fixed end gondola', doors: 0, covered: false }],
  ['GS', { kind: 'gondola', name: 'drop bottom gondola', doors: 0, covered: false }],
  ['HT', { kind: 'hopper', name: 'open top hopper', doors: 0, covered: false }],
  ['LO', { kind: 'hopper', name: 'covered hopper', doors: 0, covered: true }],
  ['FB', { kind: 'flatcar', name: 'bulkhead flatcar', doors: 0, covered: false }],
  ['FM', { kind: 'flatcar', name: 'general service flatcar', doors: 0, covered: false }],
  ['T', { kind: 'tank', name: 'tank car', doors: 0, covered: true }],
  ['TA', { kind: 'tank', name: 'lined tank car', doors: 0, covered: true }],
]);

const DESIGNATION_PATTERN = /^[A-Z]{1,4}$/;

export function mechanicalDesignation(text) {
  const value = requireString(text, 'designation').trim().toUpperCase();
  if (!DESIGNATION_PATTERN.test(value)) {
    throw new ValidationError('a mechanical designation is one to four letters', { text });
  }
  return value;
}

export function knownDesignations() {
  return [...TYPES.keys()].sort();
}

export function carType(designation) {
  const key = mechanicalDesignation(designation);
  const record = TYPES.get(key);
  if (!record) {
    throw new NotFoundError('car type', key);
  }
  return { designation: key, ...record };
}

export function tryCarType(designation) {
  try {
    return carType(designation);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return undefined;
    }
    throw error;
  }
}

export function carKind(designation) {
  return carType(designation).kind;
}

export function isCovered(designation) {
  return carType(designation).covered;
}

/** A car that can be worked at two doors can be spotted for two consignees. */
export function isMultipleSpot(designation) {
  return carType(designation).doors > 1;
}

export function designationsOfKind(kind) {
  return [...TYPES.entries()]
    .filter(([, record]) => record.kind === kind)
    .map(([key]) => key)
    .sort();
}

export function describeCarType(designation) {
  const type = carType(designation);
  return `${type.designation} ${type.name}`;
}
