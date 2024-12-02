import { requireObject, requireString } from '../core/guards.js';
import { endOfMonth, formatCivilDate, parseCivilDate, startOfMonth } from '../time/civil.js';
import { MINUTES_PER_DAY, instantFrom } from '../time/instant.js';
import { groupByCar } from '../events/ledger.js';
import { SERVICE } from '../tariff/freeTimeTable.js';
import { calendarFor } from '../config/loadConfig.js';
import { assessCar } from './assess.js';

/**
 * Running a whole month.
 *
 * Every car is priced against the page in force on the day it was placed, not
 * the page in force at month end. A page that changed mid month therefore
 * produces two prices inside one invoice, which looks like an error to anyone
 * who has not read the tariff and is the only correct answer.
 */

export function periodBounds(period, offsetMinutes = -360) {
  requireString(period, 'period');
  const first = parseCivilDate(`${period.slice(0, 4)}-${period.slice(4, 6)}-01`);
  const last = endOfMonth(first);
  return {
    from: instantFrom(startOfMonth(first), 0, offsetMinutes),
    to: instantFrom(last, MINUTES_PER_DAY, offsetMinutes),
    firstDay: formatCivilDate(first),
    lastDay: formatCivilDate(last),
  };
}

function stationOf(world, trackId) {
  const track = trackId === undefined ? undefined : world.tracks.find(trackId);
  return track?.splc;
}

function consigneeOf(world, trackId) {
  const track = trackId === undefined ? undefined : world.tracks.find(trackId);
  return track?.consigneeId;
}

export function assessMonth(world, events, { period, carrier, service = SERVICE.UNLOADING } = {}) {
  requireObject(world, 'world');
  requireString(carrier, 'carrier');
  const bounds = periodBounds(period, world.settings.offsetMinutes);
  const assessments = [];
  const skipped = [];
  for (const [carId, stream] of groupByCar(events)) {
    const inPeriod = stream.filter((record) => record.at < bounds.to);
    /**
     * A car held on the carrier's own track and then spotted belongs to the
     * consignee it was finally spotted for, not to the hold track it waited on.
     * Reading the first track with a track id put every constructively placed
     * car on nobody's invoice.
     */
    const consigned = inPeriod.find(
      (record) => record.trackId !== undefined && consigneeOf(world, record.trackId) !== undefined
    );
    const placement = consigned ?? inPeriod.find((record) => record.trackId !== undefined);
    const splc = stationOf(world, placement?.trackId);
    const consigneeId = consigneeOf(world, placement?.trackId);
    if (splc === undefined) {
      skipped.push({ carId, why: 'no track this office knows' });
      continue;
    }
    const first = inPeriod[0];
    const page = world.tariffs.find({
      carrier,
      splc,
      consigneeId,
      on: parseCivilDate(bounds.firstDay),
    })?.page;
    if (page === undefined) {
      skipped.push({ carId, why: 'no tariff page on file' });
      continue;
    }
    const car = world.cars.find(carId);
    assessments.push({
      ...assessCar({
        carId,
        events: inPeriod,
        page,
        calendar: calendarFor(world, splc),
        trackBook: world.tracks,
        exclusions: world.exclusions.forCar({ carId, splc, consigneeId }),
        query: { service, carKind: car?.kind },
        until: bounds.to,
      }),
      splc,
      consigneeId,
      firstEventAt: first?.at,
    });
  }
  return { period, bounds, assessments, skipped };
}

export function assessmentsFor(result, consigneeId) {
  return result.assessments.filter((entry) => entry.consigneeId === consigneeId);
}

export function monthTotal(result) {
  return result.assessments.reduce((sum, entry) => sum + entry.total, 0);
}

export function consigneesIn(result) {
  return [...new Set(result.assessments.map((entry) => entry.consigneeId).filter(Boolean))].sort();
}
