import { ConflictError, ValidationError } from '../core/errors.js';
import { optional, requireArray, requireOneOf, requireString } from '../core/guards.js';
import { formatCivilDate, parseCivilDate, periodKey } from '../time/civil.js';
import { DEFAULT_OFFSET_MINUTES, dateAt } from '../time/instant.js';

/**
 * Closing a period.
 *
 * Once a month is closed nothing may be assessed into it again, because the
 * invoices are out and the ledger is footed. A late event for a closed month is
 * not an error and is not lost either: it is held for the next open period,
 * which is the only handling that is both honest and workable.
 *
 * Reopening exists and is deliberately awkward. It needs a reason and it is
 * recorded, because a month that has been reopened twice is a sign of something
 * wrong upstream rather than a routine correction.
 */

export const PERIOD_STATE = Object.freeze({
  OPEN: 'open',
  CLOSING: 'closing',
  CLOSED: 'closed',
  REOPENED: 'reopened',
});

const STATES = Object.values(PERIOD_STATE);

export function periodRecord({ period, state = PERIOD_STATE.OPEN, closedOn, closedBy, note } = {}) {
  requireString(period, 'period');
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(period)) {
    throw new ValidationError('a period is written YYYYMM', { period });
  }
  requireOneOf(state, STATES, 'state');
  if (state === PERIOD_STATE.CLOSED && (closedOn === undefined || closedBy === undefined)) {
    throw new ValidationError('a closed period has to say when and by whom', { period });
  }
  return Object.freeze({
    period,
    state,
    closedOn: optional(closedOn, (value) => formatCivilDate(parseCivilDate(value))),
    closedBy: optional(closedBy, (value) => requireString(value, 'closedBy')),
    note: optional(note, (value) => requireString(value, 'note')),
    reopenings: 0,
  });
}

export function periodRegister(records = []) {
  const byPeriod = new Map();
  for (const entry of requireArray(records, 'records')) {
    const built = Object.isFrozen(entry) && entry.state ? entry : periodRecord(entry);
    byPeriod.set(built.period, built);
  }
  const register = {
    get size() {
      return byPeriod.size;
    },
    find(period) {
      return byPeriod.get(period);
    },
    stateOf(period) {
      return byPeriod.get(period)?.state ?? PERIOD_STATE.OPEN;
    },
    isOpen(period) {
      const state = register.stateOf(period);
      return state === PERIOD_STATE.OPEN || state === PERIOD_STATE.REOPENED;
    },
    close(period, { closedOn, closedBy, note } = {}) {
      if (!register.isOpen(period)) {
        throw new ConflictError('that period is already closed', { period });
      }
      const existing = byPeriod.get(period);
      const record = Object.freeze({
        ...periodRecord({ period, state: PERIOD_STATE.CLOSED, closedOn, closedBy, note }),
        reopenings: existing?.reopenings ?? 0,
      });
      byPeriod.set(period, record);
      return record;
    },
    reopen(period, reason) {
      requireString(reason, 'reason');
      const existing = byPeriod.get(period);
      if (existing === undefined || existing.state !== PERIOD_STATE.CLOSED) {
        throw new ConflictError('only a closed period can be reopened', { period });
      }
      const record = Object.freeze({
        ...existing,
        state: PERIOD_STATE.REOPENED,
        note: reason,
        reopenings: existing.reopenings + 1,
      });
      byPeriod.set(period, record);
      return record;
    },
    closedPeriods() {
      return [...byPeriod.values()]
        .filter((entry) => entry.state === PERIOD_STATE.CLOSED)
        .map((entry) => entry.period)
        .sort();
    },
    troubled() {
      return [...byPeriod.values()].filter((entry) => entry.reopenings > 1);
    },
  };
  return register;
}

/** Sort events into the period they belong to and the ones that have to wait. */
export function routeLateEvents(register, events, { offsetMinutes = DEFAULT_OFFSET_MINUTES } = {}) {
  const accepted = [];
  const held = [];
  for (const event of events) {
    const day = dateAt(event.at, offsetMinutes);
    const period = periodKey(day);
    if (register.isOpen(period)) {
      accepted.push(event);
    } else {
      held.push({ event, period });
    }
  }
  return { accepted, held };
}

export function heldCount(result) {
  return result.held.length;
}
