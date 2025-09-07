import { NotFoundError } from '../core/errors.js';
import { stationBook } from '../site/station.js';
import { trackBook } from '../site/track.js';
import { partyBook } from '../site/party.js';
import { fleet } from '../equipment/fleet.js';
import { serviceCalendar } from '../time/serviceCalendar.js';
import { tariffBook } from '../tariff/tariffBook.js';
import { switchTariff } from '../switching/switchCharge.js';
import { averageAgreement } from '../average/agreement.js';
import { orderSchedule } from '../bunching/orderSchedule.js';
import { exclusionRegistry } from '../exclusions/registry.js';
import { hireBook } from '../storage/perDiem.js';
import { STANDARD_COMMODITIES, commodityBook } from '../tariff/commodity.js';
import { waybillBook } from '../events/waybill.js';
import { lease } from '../equipment/lease.js';
import { scaleTicket } from '../equipment/scaleTicket.js';
import { interchange } from '../switching/interchange.js';
import { checkDocument, settingsOf } from './schema.js';

/**
 * Building the whole world from one document.
 *
 * Calendars are built per station rather than once, because the offset and the
 * holiday years belong to the station and a shared calendar quietly counted a
 * Memphis Saturday against a Cordova car for a whole quarter before anyone
 * looked.
 */

export function loadConfig(document) {
  checkDocument(document);
  const settings = settingsOf(document);
  const stations = stationBook(document.stations);
  const calendars = new Map();
  for (const entry of document.calendars ?? []) {
    calendars.set(entry.id, serviceCalendar({ years: settings.years, ...entry }));
  }
  for (const record of stations.all()) {
    if (!calendars.has(record.calendarId)) {
      calendars.set(
        record.calendarId,
        serviceCalendar({
          id: record.calendarId,
          offsetMinutes: record.offsetMinutes,
          years: settings.years,
        })
      );
    }
  }
  const agreements = new Map();
  for (const entry of document.agreements ?? []) {
    const built = averageAgreement(entry);
    agreements.set(built.id, built);
  }
  return Object.freeze({
    settings,
    stations,
    tracks: trackBook(document.tracks),
    parties: partyBook(document.parties),
    cars: fleet(document.cars ?? []),
    calendars,
    tariffs: tariffBook(document.tariffs, document.supplements ?? []),
    switchRates: switchTariff(document.switchRates ?? []),
    agreements,
    orders: orderSchedule(document.orders ?? []),
    exclusions: exclusionRegistry(document.exclusions ?? []),
    hireRates: hireBook(document.hireRates ?? []),
    commodities: commodityBook(document.commodities ?? STANDARD_COMMODITIES),
    waybills: waybillBook(document.waybills ?? []),
    leases: (document.leases ?? []).map((entry) =>
      entry.term === undefined ? lease(entry) : entry
    ),
    scaleTickets: (document.scaleTickets ?? []).map((entry) =>
      entry.netPounds === undefined ? scaleTicket(entry) : entry
    ),
    interchanges: (document.interchanges ?? []).map((entry) =>
      entry.deemedAcceptedAt === undefined ? interchange(entry) : entry
    ),
  });
}

export function calendarFor(world, splc) {
  const station = world.stations.find(splc);
  if (station === undefined) {
    throw new NotFoundError('station', splc);
  }
  const calendar = world.calendars.get(station.calendarId);
  if (calendar === undefined) {
    throw new NotFoundError('calendar', station.calendarId);
  }
  return calendar;
}

/** Every lease a car names, newest term first. A car names at most one. */
export function leasesForCar(world, carId) {
  const record = world.cars.find(carId);
  if (record === undefined || record.leaseId === undefined) {
    return [];
  }
  return world.leases.filter((entry) => entry.id === record.leaseId);
}

export function ticketsFor(world, carId) {
  return world.scaleTickets.filter((entry) => entry.carId === carId);
}

export function agreementFor(world, consigneeId) {
  const party = world.parties.find(consigneeId);
  if (party === undefined || party.averageAgreementId === undefined) {
    return undefined;
  }
  return world.agreements.get(party.averageAgreementId);
}

export function pageFor(world, query) {
  return world.tariffs.resolve(query);
}

export function worldSummary(world) {
  return {
    stations: world.stations.size,
    tracks: world.tracks.size,
    parties: world.parties.size,
    cars: world.cars.size,
    calendars: world.calendars.size,
    tariffs: world.tariffs.size,
    agreements: world.agreements.size,
    orders: world.orders.size,
    exclusions: world.exclusions.size,
    commodities: world.commodities.size,
    waybills: world.waybills.size,
    supplements: world.tariffs.supplements().length,
    leases: world.leases.length,
    scaleTickets: world.scaleTickets.length,
    interchanges: world.interchanges.length,
  };
}
