import { requireArray, requireString } from '../core/guards.js';
import { compareDates, daysBetween, formatCivilDate, parseCivilDate } from '../time/civil.js';

/**
 * Matching what turned up against what was asked for.
 *
 * Cars placed on a day fill that day's order first and the oldest unfilled
 * order after that, which is the way the plant would have worked them. A car
 * that fills a three day old order is bunched by three days. A car that fills
 * nothing at all was never ordered, and an unordered car gets no relief however
 * many arrived with it.
 */

export function placementRecord({ carId, placedOn, consigneeId, splc }) {
  return {
    carId: requireString(carId, 'carId'),
    placedOn: typeof placedOn === 'string' ? parseCivilDate(placedOn) : placedOn,
    consigneeId: requireString(consigneeId, 'consigneeId').trim().toUpperCase(),
    splc: requireString(splc, 'splc'),
  };
}

export function matchPlacements(placements, schedule, { consigneeId } = {}) {
  const wanted = consigneeId === undefined ? undefined : consigneeId.trim().toUpperCase();
  const rows = requireArray(placements, 'placements')
    .map(placementRecord)
    .filter((row) => wanted === undefined || row.consigneeId === wanted)
    .sort((a, b) => compareDates(a.placedOn, b.placedOn) || (a.carId < b.carId ? -1 : 1));

  const byDay = new Map();
  for (const row of rows) {
    const key = formatCivilDate(row.placedOn);
    const list = byDay.get(key);
    if (list) {
      list.push(row);
    } else {
      byDay.set(key, [row]);
    }
  }

  const backlog = [];
  const results = [];
  const orders = wanted === undefined ? schedule.all() : schedule.forConsignee(wanted);
  const orderByDay = new Map(orders.map((order) => [formatCivilDate(order.wantedOn), order]));
  const days = [...new Set([...byDay.keys(), ...orderByDay.keys()])].sort();

  for (const day of days) {
    const order = orderByDay.get(day);
    if (order !== undefined) {
      backlog.push({ day, remaining: order.cars });
    }
    const placed = byDay.get(day) ?? [];
    const groupSize = placed.length;
    for (const row of placed) {
      const slot = backlog.find((entry) => entry.remaining > 0);
      if (slot === undefined) {
        results.push({ ...row, filledOrderDay: undefined, drift: 0, bunched: false, groupSize });
        continue;
      }
      slot.remaining -= 1;
      const drift = daysBetween(parseCivilDate(slot.day), row.placedOn);
      results.push({
        ...row,
        filledOrderDay: slot.day,
        drift,
        bunched: drift > 0,
        groupSize,
      });
    }
    while (backlog.length > 0 && backlog[0].remaining === 0) {
      backlog.shift();
    }
  }
  return results;
}

export function bunchedOnly(matches) {
  return matches.filter((match) => match.bunched);
}

export function unorderedOnly(matches) {
  return matches.filter((match) => match.filledOrderDay === undefined);
}

export function groupsByDay(matches) {
  const grouped = new Map();
  for (const match of matches) {
    const key = formatCivilDate(match.placedOn);
    const list = grouped.get(key);
    if (list) {
      list.push(match);
    } else {
      grouped.set(key, [match]);
    }
  }
  return grouped;
}

export function largestGroup(matches) {
  return matches.reduce((best, match) => Math.max(best, match.groupSize), 0);
}
