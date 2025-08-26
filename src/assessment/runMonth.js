import { requireObject, requireString } from '../core/guards.js';
import { endOfMonth, formatCivilDate, parseCivilDate, startOfMonth } from '../time/civil.js';
import { DEFAULT_OFFSET_MINUTES, MINUTES_PER_DAY, dateAt, instantFrom } from '../time/instant.js';
import { groupByCar } from '../events/ledger.js';
import { SERVICE } from '../tariff/freeTimeTable.js';
import { serviceFor } from '../events/waybill.js';
import { calendarFor } from '../config/loadConfig.js';
import { suspensionsFrom } from '../clock/suspension.js';
import { matchPlacements } from '../bunching/grouping.js';
import { bunchingRelief, extraFreeDaysFor } from '../bunching/relief.js';
import { assessCar } from './assess.js';

/**
 * Running a whole month.
 *
 * Every car is priced against the page in force on the day it was placed, not
 * the page in force at month end. A page that changed mid month therefore
 * produces two prices inside one invoice, which looks like an error to anyone
 * who has not read the tariff and is the only correct answer.
 */

export function periodBounds(period, offsetMinutes = DEFAULT_OFFSET_MINUTES) {
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

/**
 * Everything about a car that is pure lookup: where it stood, who it was
 * consigned to, which page prices it and what the waybill says it is carrying.
 * Split out because bunching needs every car's placement before any car can be
 * counted, so the month is now two passes over this rather than one.
 */
export function resolveCar(world, carId, inPeriod, { carrier, bounds, service }) {
  const consigned = inPeriod.find(
    (record) => record.trackId !== undefined && consigneeOf(world, record.trackId) !== undefined
  );
  const placement = consigned ?? inPeriod.find((record) => record.trackId !== undefined);
  const splc = stationOf(world, placement?.trackId);
  const consigneeId = consigneeOf(world, placement?.trackId);
  if (splc === undefined) {
    return { skip: 'no track this office knows' };
  }
  const page = world.tariffs.find({
    carrier,
    splc,
    consigneeId,
    on: parseCivilDate(bounds.firstDay),
  })?.page;
  if (page === undefined) {
    return { skip: 'no tariff page on file' };
  }
  /**
   * The waybill in force on the day the car was placed, not on the first of the
   * month. Reading it on the first dropped the commodity for every car
   * waybilled after the 1st, which is most of them, and they fell silently to
   * the bare service line with the shortest allowance in the book.
   */
  const placedOn =
    placement === undefined
      ? bounds.firstDay
      : formatCivilDate(dateAt(placement.at, world.settings.offsetMinutes));
  const bill = world.waybills.onDate(carId, placedOn);
  const commodityClass =
    bill === undefined || bill.commodityCode === undefined
      ? undefined
      : world.commodities.classOf(bill.commodityCode);
  return {
    splc,
    consigneeId,
    page,
    placement,
    car: world.cars.find(carId),
    commodityClass,
    placedOn,
    service: service ?? (bill === undefined ? SERVICE.UNLOADING : serviceFor(bill)),
  };
}

/**
 * Bunching relief, which until now was implemented, tested and reached by
 * nothing. It cannot be worked out car by car: whether a drift counts at all
 * depends on how many cars turned up that day, so every placement in the month
 * has to be matched against the order schedule in one go before any car is
 * counted.
 */
export function bunchingFor(world, resolved) {
  const placements = [];
  for (const [carId, entry] of resolved) {
    if (entry.consigneeId === undefined || entry.placement === undefined) {
      continue;
    }
    placements.push({
      carId,
      trackId: entry.placement.trackId,
      consigneeId: entry.consigneeId,
      splc: entry.splc,
      placedOn: formatCivilDate(dateAt(entry.placement.at, world.settings.offsetMinutes)),
    });
  }
  if (placements.length === 0 || world.orders.size === 0) {
    return new Map();
  }
  const relieved = new Map();
  for (const consigneeId of new Set(placements.map((entry) => entry.consigneeId))) {
    const page = resolved.get(
      placements.find((entry) => entry.consigneeId === consigneeId).carId
    ).page;
    const matches = matchPlacements(placements, world.orders, { consigneeId });
    for (const row of bunchingRelief(matches, { page, schedule: world.orders })) {
      relieved.set(row.carId, extraFreeDaysFor([row], row.carId));
    }
  }
  return relieved;
}

export function assessMonth(world, events, { period, carrier, service } = {}) {
  requireObject(world, 'world');
  requireString(carrier, 'carrier');
  const bounds = periodBounds(period, world.settings.offsetMinutes);
  const assessments = [];
  const skipped = [];
  const streams = new Map();
  const resolved = new Map();
  for (const [carId, stream] of groupByCar(events)) {
    const inPeriod = stream.filter((record) => record.at < bounds.to);
    streams.set(carId, inPeriod);
    const entry = resolveCar(world, carId, inPeriod, { carrier, bounds, service });
    if (entry.skip !== undefined) {
      skipped.push({ carId, why: entry.skip });
      continue;
    }
    resolved.set(carId, entry);
  }
  const bunching = bunchingFor(world, resolved);
  for (const [carId, entry] of resolved) {
    const inPeriod = streams.get(carId);
    const { splc, consigneeId, page, car, commodityClass } = entry;
    const resolvedService = entry.service;
    const first = inPeriod[0];
    const suspensions = suspensionsFrom(inPeriod, { until: bounds.to, splc, consigneeId });
    const relief = [
      ...world.exclusions.forCar({ carId, splc, consigneeId }),
      ...suspensions.exclusions,
    ];
    assessments.push({
      ...assessCar({
        carId,
        events: inPeriod,
        page,
        calendar: calendarFor(world, splc),
        trackBook: world.tracks,
        exclusions: relief,
        query: { service: resolvedService, carKind: car?.kind, commodityClass },
        until: bounds.to,
        extraFreeDays: bunching.get(carId) ?? 0,
      }),
      splc,
      consigneeId,
      commodityClass,
      service: resolvedService,
      suspensions: suspensions.exclusions,
      unclosedSuspensions: suspensions.unclosed,
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
