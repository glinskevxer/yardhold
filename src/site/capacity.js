import { NotFoundError, ValidationError } from '../core/errors.js';
import { requireArray, requireObject } from '../core/guards.js';
import { addDays, compareDates, eachDay, formatCivilDate, parseCivilDate } from '../time/civil.js';

/**
 * Track occupancy.
 *
 * Worth computing because it is the consignee's best defence. A plant whose
 * industry track was full every day of the month did not fail to take its cars;
 * it had nowhere to put them, and a car held on the carrier's track for that
 * reason is constructively placed and billable, which is exactly the argument
 * the numbers here either support or destroy.
 */

export function occupancyByDay(placements, { from, to } = {}) {
  requireArray(placements, 'placements');
  const start = typeof from === 'string' ? parseCivilDate(from) : from;
  const end = typeof to === 'string' ? parseCivilDate(to) : to;
  if (start === undefined || end === undefined) {
    throw new ValidationError('occupancy needs a window', {});
  }
  if (compareDates(start, end) > 0) {
    throw new ValidationError('an occupancy window cannot end before it starts', {});
  }
  const counts = new Map(eachDay(start, end).map((day) => [formatCivilDate(day), 0]));
  for (const entry of placements) {
    const placedOn =
      typeof entry.placedOn === 'string' ? parseCivilDate(entry.placedOn) : entry.placedOn;
    const releasedOn =
      entry.releasedOn === undefined
        ? end
        : typeof entry.releasedOn === 'string'
          ? parseCivilDate(entry.releasedOn)
          : entry.releasedOn;
    if (compareDates(placedOn, end) > 0 || compareDates(releasedOn, start) < 0) {
      continue;
    }
    for (const day of eachDay(placedOn, releasedOn)) {
      const key = formatCivilDate(day);
      if (counts.has(key)) {
        counts.set(key, counts.get(key) + 1);
      }
    }
  }
  return counts;
}

export function trackOccupancy(track, placements, window) {
  requireObject(track, 'track');
  const counts = occupancyByDay(
    placements.filter((entry) => entry.trackId === track.id),
    window
  );
  const rows = [...counts.entries()].map(([date, cars]) => ({
    date,
    trackId: track.id,
    cars,
    capacity: track.capacityCars,
    full: cars >= track.capacityCars,
    spare: Math.max(0, track.capacityCars - cars),
  }));
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function fullDays(rows) {
  return rows.filter((row) => row.full).map((row) => row.date);
}

export function peakOccupancy(rows) {
  return rows.reduce((best, row) => Math.max(best, row.cars), 0);
}

export function averageOccupancy(rows) {
  if (rows.length === 0) {
    return 0;
  }
  return Math.round((rows.reduce((sum, row) => sum + row.cars, 0) / rows.length) * 100) / 100;
}

export function utilisation(rows) {
  if (rows.length === 0) {
    return 0;
  }
  const capacity = rows.reduce((sum, row) => sum + row.capacity, 0);
  if (capacity === 0) {
    return 0;
  }
  const cars = rows.reduce((sum, row) => sum + row.cars, 0);
  return Math.round((cars / capacity) * 1000) / 1000;
}

export function wasFullOn(rows, date) {
  const key = typeof date === 'string' ? date : formatCivilDate(date);
  return rows.find((row) => row.date === key)?.full ?? false;
}

export function firstSpareDay(rows, after) {
  const from = typeof after === 'string' ? after : formatCivilDate(after);
  return rows.find((row) => row.date > from && !row.full)?.date;
}

export function occupancyFor(trackBook, trackId, placements, window) {
  const track = trackBook.find(trackId);
  if (track === undefined) {
    throw new NotFoundError('track', trackId);
  }
  return trackOccupancy(track, placements, window);
}

export function nextDay(date) {
  return formatCivilDate(addDays(typeof date === 'string' ? parseCivilDate(date) : date, 1));
}
