import { requireArray } from '../core/guards.js';
import { formatInstant } from '../time/instant.js';
import { groupByCar } from './ledger.js';
import { eventKind } from './eventTypes.js';

/**
 * A trip is one visit to the property: the car arrived, something happened to
 * it, and it left. Cars come back, so a stream covers several trips and they
 * have to be told apart before anything is counted, or a car that made three
 * trips in a month looks like one car that stood for thirty days.
 *
 * The boundary is a departure. Not a release and not a pull, because a car
 * pulled from the industry track and left in the yard is still here.
 */

export function splitTrips(events) {
  requireArray(events, 'events');
  const trips = [];
  let current = [];
  for (const record of events) {
    current.push(record);
    if (record.code === 'DEP') {
      trips.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    trips.push(current);
  }
  return trips;
}

export function tripSummary(events) {
  const arrival = events.find((record) => record.code === 'ARR');
  const departure = events.find((record) => record.code === 'DEP');
  const placements = events.filter((record) => eventKind(record.code).starts);
  const releases = events.filter((record) => eventKind(record.code).stops && record.code !== 'DEP');
  return {
    carId: events[0]?.carId,
    arrivedAt: arrival?.at,
    departedAt: departure?.at,
    placements: placements.length,
    releases: releases.length,
    firstPlacedAt: placements[0]?.at,
    lastReleasedAt: releases[releases.length - 1]?.at,
    tracks: [...new Set(events.map((record) => record.trackId).filter(Boolean))],
    open: departure === undefined,
    events,
  };
}

export function tripsForCar(events) {
  return splitTrips(events).map(tripSummary);
}

export function tripsByCar(events) {
  const grouped = new Map();
  for (const [carId, stream] of groupByCar(events)) {
    grouped.set(carId, tripsForCar(stream));
  }
  return grouped;
}

export function tripMinutes(trip) {
  if (trip.arrivedAt === undefined || trip.departedAt === undefined) {
    return undefined;
  }
  return trip.departedAt - trip.arrivedAt;
}

export function openTrips(trips) {
  return trips.filter((trip) => trip.open);
}

export function repeatVisitors(byCar, { minimumTrips = 2 } = {}) {
  return [...byCar.entries()]
    .filter(([, trips]) => trips.length >= minimumTrips)
    .map(([carId, trips]) => ({ carId, trips: trips.length }))
    .sort((a, b) => b.trips - a.trips || (a.carId < b.carId ? -1 : 1));
}

export function describeTrip(trip, offsetMinutes = 0) {
  const arrived =
    trip.arrivedAt === undefined ? 'unknown' : formatInstant(trip.arrivedAt, offsetMinutes);
  const departed = trip.open ? 'still here' : formatInstant(trip.departedAt, offsetMinutes);
  return `${trip.carId} ${arrived} to ${departed}, ${trip.placements} placement(s)`;
}
