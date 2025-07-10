import { ValidationError } from '../core/errors.js';
import { optional, requireOneOf, requireString } from '../core/guards.js';
import { fingerprint } from '../core/ids.js';
import { DEFAULT_OFFSET_MINUTES, formatInstant, parseInstant } from '../time/instant.js';

/**
 * The audit trail.
 *
 * A demurrage bill is reopened months later and the only defensible answer is
 * what the office knew on the day it cut the paper. Every entry therefore
 * carries the fingerprint of its inputs, so a recomputation that disagrees can
 * be told apart from a recomputation that was fed different facts.
 */

export const ACTION = Object.freeze({
  INGESTED: 'ingested',
  ASSESSED: 'assessed',
  INVOICED: 'invoiced',
  CLAIM_FILED: 'claim-filed',
  CLAIM_DECIDED: 'claim-decided',
  PAYMENT_APPLIED: 'payment-applied',
  CONFIG_LOADED: 'config-loaded',
});

const ACTIONS = Object.values(ACTION);

export function auditEntry({
  action,
  at,
  offsetMinutes = DEFAULT_OFFSET_MINUTES,
  actor,
  subject,
  inputs = [],
  note,
} = {}) {
  requireOneOf(action, ACTIONS, 'action');
  requireString(actor, 'actor');
  requireString(subject, 'subject');
  const moment = typeof at === 'number' ? at : parseInstant(requireString(at, 'at'), offsetMinutes);
  if (!Array.isArray(inputs)) {
    throw new ValidationError('audit inputs have to be a list', { action });
  }
  const record = {
    action,
    at: moment,
    offsetMinutes,
    actor,
    subject,
    inputs: Object.freeze([...inputs]),
    inputFingerprint: fingerprint(inputs),
    note: optional(note, (value) => requireString(value, 'note')),
  };
  record.id = fingerprint([record.action, record.at, record.subject, record.inputFingerprint]);
  return Object.freeze(record);
}

export function auditTrail(entries = []) {
  const all = entries.map((entry) => (entry.inputFingerprint ? entry : auditEntry(entry)));
  const trail = {
    get size() {
      return all.length;
    },
    record(entry) {
      const built = entry.inputFingerprint ? entry : auditEntry(entry);
      all.push(built);
      return built;
    },
    all() {
      return [...all].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    },
    forSubject(subject) {
      return trail.all().filter((entry) => entry.subject === subject);
    },
    ofAction(action) {
      requireOneOf(action, ACTIONS, 'action');
      return trail.all().filter((entry) => entry.action === action);
    },
    lastFor(subject, action) {
      const matches = trail
        .forSubject(subject)
        .filter((entry) => action === undefined || entry.action === action);
      return matches[matches.length - 1];
    },
  };
  return trail;
}

/** Did the inputs change between two runs over the same subject. */
export function inputsChanged(before, after) {
  return before.inputFingerprint !== after.inputFingerprint;
}

export function describeEntry(entry) {
  return `${formatInstant(entry.at, entry.offsetMinutes)} ${entry.actor} ${entry.action} ${entry.subject} ${entry.inputFingerprint}`;
}

export function trailLines(trail) {
  return trail.all().map(describeEntry);
}
