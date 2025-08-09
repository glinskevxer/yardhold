import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/guards.js';
import { fleetSummary } from '../../equipment/fleet.js';
import { chargeBook } from '../../equipment/car.js';
import { describeLease, isLeaseActive, leaseExpired, selectLease } from '../../equipment/lease.js';
import {
  billableWeight,
  isOverloaded,
  latestAdmissible,
  overloadPounds,
  refusalReason,
  ticketsForCar,
} from '../../equipment/scaleTicket.js';
import { leasesForCar, ticketsFor } from '../../config/loadConfig.js';
import { OUTPUT, keyValueBlock, renderRows } from '../format.js';
import { loadWorld, resolveOutput } from '../context.js';

/**
 * spurtally fleet
 *
 * The register, the lease behind each private car and the weight the office
 * would bill on. All three were library only: you could describe a lease and
 * you could work out whether a scale ticket was admissible, and there was
 * nowhere to look either of them up.
 *
 * Takes no event feed on purpose. This is the standing state of the equipment,
 * not what happened to it in a month, and needing a month of events to answer
 * "is that lease still running" is how a question that takes ten seconds turns
 * into a billing run.
 */

const COLUMNS = ['car', 'type', 'ownership', 'book', 'lease', 'leaseState', 'weight', 'flag'];

export function leaseStateFor(world, carId, asOf) {
  const leases = leasesForCar(world, carId);
  if (leases.length === 0) {
    return { lease: undefined, state: 'none' };
  }
  const active = selectLease(leases, asOf);
  if (active !== undefined) {
    return { lease: active, state: 'active' };
  }
  const expired = leases.some((entry) => leaseExpired(entry, asOf));
  return { lease: leases[0], state: expired ? 'expired' : 'not-yet-in-term' };
}

export function weightFor(world, record) {
  const tickets = ticketsFor(world, record.id);
  if (tickets.length === 0) {
    return { weight: undefined, why: 'never weighed' };
  }
  const usable = latestAdmissible(tickets, record.id);
  if (usable === undefined) {
    const last = ticketsForCar(tickets, record.id).pop();
    return { weight: undefined, why: refusalReason(last) };
  }
  return {
    weight: billableWeight(usable, record),
    ticket: usable,
    overload: overloadPounds(usable, record),
  };
}

export function fleetRows(world, { asOf }) {
  return world.cars.all().map((record) => {
    const { lease, state } = leaseStateFor(world, record.id, asOf);
    const weight = weightFor(world, record);
    const flags = [];
    if (state === 'expired') {
      flags.push('lease expired');
    }
    if (record.leaseId !== undefined && lease === undefined) {
      flags.push('lease not on file');
    }
    /**
     * Never having been weighed is the ordinary case, not a fault. Most cars
     * over this track never cross a scale. What is worth flagging is a ticket
     * that exists and cannot be used, because somebody paid to weigh the car
     * and the office still has no weight it can bill on.
     */
    if (weight.weight === undefined && weight.why !== 'never weighed') {
      flags.push(weight.why);
    } else if (weight.ticket !== undefined && isOverloaded(weight.ticket, record)) {
      flags.push(`overloaded by ${weight.overload} lb`);
    }
    return {
      car: record.id,
      type: record.designation,
      ownership: record.ownership,
      book: chargeBook(record),
      lease: record.leaseId ?? '',
      leaseState: state,
      weight: weight.weight ?? '',
      flag: flags.join('; '),
    };
  });
}

export function fleetBody(world, { asOf, output = OUTPUT.TABLE, flagged = false, car } = {}) {
  const rows = fleetRows(world, { asOf });
  let shown = flagged ? rows.filter((row) => row.flag !== '') : rows;
  if (car !== undefined) {
    const wanted = world.cars.get(car).id;
    shown = shown.filter((row) => row.car === wanted);
  }
  if (output === OUTPUT.JSON) {
    return JSON.stringify({ asOf, summary: fleetSummary(world.cars), rows: shown }, null, 2);
  }
  if (output === OUTPUT.CSV) {
    return renderRows(shown, OUTPUT.CSV, COLUMNS);
  }
  if (shown.length === 0) {
    return flagged ? 'nothing flagged' : 'no cars on the register';
  }
  const summary = fleetSummary(world.cars);
  return [
    renderRows(shown, OUTPUT.TABLE, COLUMNS),
    '',
    keyValueBlock({
      cars: summary.total,
      railroad: summary.railroad,
      private: summary.private,
      leases: world.leases.length,
      'scale tickets': world.scaleTickets.length,
    }),
  ].join('\n');
}

export function leaseLines(world, asOf) {
  return world.leases.map(
    (record) => `${describeLease(record)} ${isLeaseActive(record, asOf) ? 'active' : 'not active'}`
  );
}

export function runFleet(options, deps = {}) {
  const output = resolveOutput(options.output);
  const asOf = requireString(options.asOf, 'asOf');
  const world = loadWorld(options.config, deps);
  if (options.car !== undefined && world.cars.find(options.car) === undefined) {
    throw new ValidationError('that car is not on the register', {
      car: options.car,
      known: world.cars.size,
    });
  }
  return {
    text: fleetBody(world, { asOf, output, flagged: options.flagged === true, car: options.car }),
    world,
    rows: fleetRows(world, { asOf }),
  };
}
