import { ValidationError } from './errors.js';

/**
 * Small guards used at the edge of every module. They exist so a bad record
 * fails where it entered rather than four calls later inside the ladder.
 */

export function requireString(value, field, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`, { field, value });
  }
  if (!allowEmpty && value.trim() === '') {
    throw new ValidationError(`${field} must not be blank`, { field });
  }
  return value;
}

export function requireInteger(value, field, { min, max } = {}) {
  if (!Number.isInteger(value)) {
    throw new ValidationError(`${field} must be a whole number`, { field, value });
  }
  if (min !== undefined && value < min) {
    throw new ValidationError(`${field} must be at least ${min}`, { field, value, min });
  }
  if (max !== undefined && value > max) {
    throw new ValidationError(`${field} must be at most ${max}`, { field, value, max });
  }
  return value;
}

export function requireOneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`, {
      field,
      value,
      allowed,
    });
  }
  return value;
}

export function requireObject(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`, { field, value });
  }
  return value;
}

export function requireArray(value, field, { minLength = 0 } = {}) {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array`, { field, value });
  }
  if (value.length < minLength) {
    throw new ValidationError(`${field} needs at least ${minLength} entries`, {
      field,
      length: value.length,
    });
  }
  return value;
}

export function optional(value, apply) {
  return value === undefined || value === null ? undefined : apply(value);
}

export function requireUnique(values, field, keyOf = (value) => value) {
  const seen = new Set();
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) {
      throw new ValidationError(`${field} contains a duplicate entry`, { field, key });
    }
    seen.add(key);
  }
  return values;
}

export function frozen(value) {
  return Object.freeze(value);
}
