import { requireObject } from '../core/guards.js';
import { formatCivilDate } from '../time/civil.js';
import { groupsByDay } from './grouping.js';

/**
 * Bunching relief.
 *
 * Being late is not being bunched. A plant that ordered two cars and got two
 * cars three days late waited, and waiting is what free time is for. A plant
 * that ordered two and got six has to unload six with one crew, and that is
 * what the relief answers.
 *
 * So the size of the group decides whether the drift counts at all, and the
 * drift then decides how many days each car in the group is given. Two rules,
 * and each one is reading the output of the other.
 */

export function reliefForGroup(matches, schedule, { capDays } = {}) {
  const day = matches[0].placedOn;
  const ordered = schedule.carsOrderedOn(matches[0].consigneeId, day);
  const oversupplied = matches.length > ordered;
  return matches.map((match) => {
    if (!oversupplied || !match.bunched) {
      return { ...match, extraFreeDays: 0, why: oversupplied ? 'on time' : 'not oversupplied' };
    }
    return {
      ...match,
      extraFreeDays: Math.min(match.drift, capDays),
      why: 'bunched',
    };
  });
}

export function bunchingRelief(matches, { page, schedule, capDays } = {}) {
  requireObject(page, 'page');
  requireObject(schedule, 'schedule');
  if (!page.bunchingRelief) {
    return matches.map((match) => ({ ...match, extraFreeDays: 0, why: 'page grants no relief' }));
  }
  const cap = capDays ?? page.bunchingCapDays;
  const out = [];
  for (const group of groupsByDay(matches).values()) {
    out.push(...reliefForGroup(group, schedule, { capDays: cap }));
  }
  return out.sort(
    (a, b) =>
      formatCivilDate(a.placedOn).localeCompare(formatCivilDate(b.placedOn)) ||
      a.carId.localeCompare(b.carId)
  );
}

export function extraFreeDaysFor(relieved, carId) {
  return relieved.find((entry) => entry.carId === carId)?.extraFreeDays ?? 0;
}

export function totalExtraFreeDays(relieved) {
  return relieved.reduce((sum, entry) => sum + entry.extraFreeDays, 0);
}

export function relievedCars(relieved) {
  return relieved.filter((entry) => entry.extraFreeDays > 0).map((entry) => entry.carId);
}
