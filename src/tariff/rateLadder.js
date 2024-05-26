import { ValidationError } from '../core/errors.js';
import { requireArray, requireInteger, requireOneOf } from '../core/guards.js';
import { add, parseMoney, times } from '../core/money.js';

/**
 * The rate ladder. Demurrage is progressive: the first chargeable day is cheap
 * and the fifth is not, which is the whole point of the charge.
 *
 * What a day's position on the ladder means depends on when the ladder resets:
 *
 *   detention   the ladder restarts at every placement
 *   month       the ladder counts every chargeable day in the billing month,
 *               so a car placed on the 28th climbs a ladder the earlier cars
 *               already walked up
 *
 * The reset rule is a property of the tariff, and it decides what the day index
 * every rung is keyed on actually counts.
 */

export const LADDER_RESET = Object.freeze({
  DETENTION: 'detention',
  MONTH: 'month',
});

const RESETS = Object.values(LADDER_RESET);

export function rung(fromDay, rate, { toDay } = {}) {
  requireInteger(fromDay, 'fromDay', { min: 1 });
  const amount = typeof rate === 'number' ? rate : parseMoney(rate);
  if (amount < 0) {
    throw new ValidationError('a ladder rate cannot be negative', { fromDay });
  }
  if (toDay !== undefined) {
    requireInteger(toDay, 'toDay', { min: fromDay });
  }
  return Object.freeze({ fromDay, toDay, rate: amount });
}

export function rateLadder(rungs = [], { reset = LADDER_RESET.DETENTION, dailyCap } = {}) {
  requireOneOf(reset, RESETS, 'reset');
  const built = requireArray(rungs, 'rungs', { minLength: 1 }).map((entry) =>
    entry.rate !== undefined && entry.fromDay !== undefined && Object.isFrozen(entry)
      ? entry
      : rung(entry.fromDay, entry.rate, entry)
  );
  const sorted = [...built].sort((a, b) => a.fromDay - b.fromDay);
  if (sorted[0].fromDay !== 1) {
    throw new ValidationError('a ladder has to start at the first chargeable day', {
      fromDay: sorted[0].fromDay,
    });
  }
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].fromDay === sorted[index - 1].fromDay) {
      throw new ValidationError('two rungs start on the same day', {
        fromDay: sorted[index].fromDay,
      });
    }
  }
  const cap = dailyCap === undefined ? undefined : parseMoney(String(dailyCap));
  return Object.freeze({ reset, rungs: Object.freeze(sorted), dailyCap: cap });
}

export function rateForDay(ladder, dayIndex) {
  requireInteger(dayIndex, 'dayIndex', { min: 1 });
  let found;
  for (const entry of ladder.rungs) {
    if (entry.fromDay > dayIndex) {
      break;
    }
    if (entry.toDay !== undefined && entry.toDay < dayIndex) {
      continue;
    }
    found = entry;
  }
  if (found === undefined) {
    return 0;
  }
  return ladder.dailyCap === undefined ? found.rate : Math.min(found.rate, ladder.dailyCap);
}

/** Charge a run of chargeable days that start at `startIndex` on the ladder. */
export function chargeDays(ladder, count, { startIndex = 1 } = {}) {
  requireInteger(count, 'count', { min: 0 });
  requireInteger(startIndex, 'startIndex', { min: 1 });
  const lines = [];
  for (let offset = 0; offset < count; offset += 1) {
    const dayIndex = startIndex + offset;
    lines.push({ dayIndex, rate: rateForDay(ladder, dayIndex) });
  }
  return lines;
}

export function totalFor(ladder, count, options) {
  return add(...chargeDays(ladder, count, options).map((line) => line.rate));
}

export function flatLadder(rate, options) {
  return rateLadder([{ fromDay: 1, rate }], options);
}

export function ladderCeiling(ladder) {
  return ladder.rungs.reduce((best, entry) => Math.max(best, entry.rate), 0);
}

export function resetsEachDetention(ladder) {
  return ladder.reset === LADDER_RESET.DETENTION;
}

export function describeLadder(ladder) {
  return ladder.rungs
    .map((entry) => {
      const upper = entry.toDay === undefined ? '+' : `-${entry.toDay}`;
      return `${entry.fromDay}${upper} at ${entry.rate}`;
    })
    .join(', ');
}

export function timesRate(rate, count) {
  return times(rate, count);
}
