import { requireInteger, requireString } from '../core/guards.js';
import {
  addDays,
  compareDates,
  daysBetween,
  formatCivilDate,
  parseCivilDate,
} from '../time/civil.js';
import { GROUND } from './claim.js';

/**
 * Time limits.
 *
 * The window a claim has to be filed inside depends on the ground, and the
 * reason is practical rather than legal: an arithmetic error is on the face of
 * the paper and can be found any time, while a claim that the car was released
 * earlier than reported depends on a gate log the plant keeps for ninety days
 * and then destroys. So the ground decides the window, and a claim that is
 * timely on one ground is barred on another for the very same facts.
 */

export const DEFAULT_WINDOWS = Object.freeze({
  [GROUND.WRONG_EVENTS]: 90,
  [GROUND.RELIEF_NOT_GIVEN]: 120,
  [GROUND.WRONG_TARIFF]: 180,
  [GROUND.WRONG_PARTY]: 180,
  [GROUND.ARITHMETIC]: 365,
  [GROUND.BUNCHING]: 90,
});

export const DECISION_DAYS = 45;

export function filingWindowDays(ground, windows = DEFAULT_WINDOWS) {
  return windows[ground] ?? 0;
}

export function filingDeadline(invoicedOn, ground, windows) {
  const issued = parseCivilDate(requireString(invoicedOn, 'invoicedOn'));
  return formatCivilDate(addDays(issued, filingWindowDays(ground, windows)));
}

export function isTimely(record, invoicedOn, windows) {
  const deadline = parseCivilDate(filingDeadline(invoicedOn, record.ground, windows));
  return compareDates(parseCivilDate(record.filedOn), deadline) <= 0;
}

export function daysLate(record, invoicedOn, windows) {
  const deadline = parseCivilDate(filingDeadline(invoicedOn, record.ground, windows));
  const filed = parseCivilDate(record.filedOn);
  return Math.max(0, daysBetween(deadline, filed));
}

export function decisionDeadline(filedOn, days = DECISION_DAYS) {
  requireInteger(days, 'days', { min: 1, max: 365 });
  return formatCivilDate(addDays(parseCivilDate(requireString(filedOn, 'filedOn')), days));
}

export function isDecisionOverdue(record, asOf, days = DECISION_DAYS) {
  const deadline = parseCivilDate(decisionDeadline(record.filedOn, days));
  return compareDates(parseCivilDate(asOf), deadline) > 0;
}

/**
 * A claim barred on the ground it was filed on may still be timely on another,
 * which is what the clerk actually needs to know before writing the refusal.
 */
export function groundsStillOpen(filedOn, invoicedOn, windows = DEFAULT_WINDOWS) {
  const filed = parseCivilDate(requireString(filedOn, 'filedOn'));
  return Object.keys(windows)
    .filter((ground) => {
      const deadline = parseCivilDate(filingDeadline(invoicedOn, ground, windows));
      return compareDates(filed, deadline) <= 0;
    })
    .sort();
}

export function barredReason(record, invoicedOn, windows) {
  if (isTimely(record, invoicedOn, windows)) {
    return undefined;
  }
  const late = daysLate(record, invoicedOn, windows);
  return `filed ${late} day${late === 1 ? '' : 's'} after the ${record.ground} window closed`;
}
