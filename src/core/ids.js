import { ValidationError } from './errors.js';
import { requireInteger, requireString } from './guards.js';

/**
 * Reference numbers. Invoices, claims and assessments all need a key that a
 * clerk can read over the phone to the carrier, so the shape is a short prefix,
 * the period and a zero padded sequence.
 */

const PREFIX_PATTERN = /^[A-Z]{2,4}$/;

export function referenceNumber(prefix, period, sequence, { width = 5 } = {}) {
  requireString(prefix, 'prefix');
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new ValidationError('reference prefix must be two to four capitals', { prefix });
  }
  requireString(period, 'period');
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(period)) {
    throw new ValidationError('reference period must be YYYYMM', { period });
  }
  requireInteger(sequence, 'sequence', { min: 1 });
  return `${prefix}-${period}-${String(sequence).padStart(width, '0')}`;
}

export function parseReference(reference) {
  requireString(reference, 'reference');
  const match = /^([A-Z]{2,4})-(\d{6})-(\d+)$/.exec(reference);
  if (!match) {
    throw new ValidationError('reference is not in prefix period sequence form', { reference });
  }
  return { prefix: match[1], period: match[2], sequence: Number(match[3]) };
}

export function sequencer(start = 1) {
  let next = requireInteger(start, 'start', { min: 1 });
  return {
    next() {
      const value = next;
      next += 1;
      return value;
    },
    peek() {
      return next;
    },
    reset(to = 1) {
      next = requireInteger(to, 'to', { min: 1 });
    },
  };
}

/**
 * A stable 32 bit hash over a string. Used for deterministic ordering and for
 * the audit fingerprint, never for anything that needs to resist tampering.
 */
export function stableHash(text) {
  requireString(text, 'text', { allowEmpty: true });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Fingerprint a tuple of fields. The length prefix keeps two different splits
 * of the same characters from landing on the same value.
 */
export function fingerprint(parts) {
  const joined = parts
    .map((part) => (part === undefined || part === null ? '' : String(part)))
    .map((part) => `${part.length}:${part}`)
    .join('|');
  return stableHash(joined);
}

export function slug(text) {
  return requireString(text, 'text')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
