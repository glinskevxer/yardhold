import { requireInteger, requireObject } from '../core/guards.js';
import { dayUnits } from '../time/dayCount.js';
import { isServiceDay } from '../time/serviceCalendar.js';
import { chargeableUnitOptions, freeTimeCountsServiceDays, freeTimeFor } from '../tariff/tariff.js';
import { relieveSpan } from '../exclusions/apply.js';

/**
 * The count.
 *
 * Order matters and it is not obvious. Relief comes off the span before the
 * days are cut, because a page that removes minutes can turn two part days
 * into one; free time is then spent on the days that are left. Doing it the
 * other way round gives the consignee free time it has already been credited
 * for once.
 *
 * The free time entry decides which days can be spent at all. On a running day
 * entry every day counts. On a service day entry the days the carrier did not
 * work are stepped over entirely, so they are neither free nor chargeable, and
 * the same Saturday is a free day under one commodity and invisible under
 * another.
 */

export function countChargeableDays(
  detention,
  { page, calendar, exclusions = [], query, startIndex = 1 } = {}
) {
  requireObject(page, 'page');
  requireInteger(startIndex, 'startIndex', { min: 1 });
  if (detention.span === undefined) {
    return emptyCount(startIndex);
  }
  const offsetMinutes = calendar?.offsetMinutes ?? -360;
  const relief = relieveSpan(detention.span, exclusions, {
    page,
    offsetMinutes,
    placement: detention.kind,
    carId: detention.carId,
  });
  const options = { ...chargeableUnitOptions(page), offsetMinutes };
  const units = relief.pieces.flatMap((piece) => dayUnits(piece, options));
  const serviceOnly = freeTimeCountsServiceDays(page, query);
  const allowance = freeTimeFor(page, query);

  const free = [];
  const charged = [];
  const skipped = [];
  let spent = 0;
  let index = startIndex;
  for (const unit of units) {
    if (serviceOnly && calendar !== undefined && !isServiceDay(calendar, unit.date)) {
      skipped.push({ ...unit, why: 'not a service day' });
      continue;
    }
    if (spent < allowance) {
      spent += 1;
      free.push({ ...unit, why: 'free time' });
      continue;
    }
    charged.push({ ...unit, dayIndex: index });
    index += 1;
  }

  return {
    units,
    free,
    charged,
    skipped,
    allowance,
    freeUsed: spent,
    chargeableCount: charged.length,
    nextIndex: index,
    relief,
  };
}

function emptyCount(startIndex) {
  return {
    units: [],
    free: [],
    charged: [],
    skipped: [],
    allowance: 0,
    freeUsed: 0,
    chargeableCount: 0,
    nextIndex: startIndex,
    relief: { applied: [], declined: [], removedMinutes: 0, droppedUnits: [], pieces: [] },
  };
}

export function chargeableLabels(count) {
  return count.charged.map((unit) => unit.label);
}

export function freeLabels(count) {
  return count.free.map((unit) => unit.label);
}

export function skippedLabels(count) {
  return count.skipped.map((unit) => unit.label);
}

export function unusedFreeTime(count) {
  return Math.max(0, count.allowance - count.freeUsed);
}
