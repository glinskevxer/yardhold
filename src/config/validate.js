import { requireObject } from '../core/guards.js';

/**
 * Checking a configuration that is already well formed.
 *
 * The schema says the sections are there and the builders say each record is
 * sound. What neither of them can see is whether the records agree with each
 * other, and every one of these has actually happened: a track pointing at a
 * consignee nobody entered, an agreement for a party that left, a station whose
 * carrier has no tariff on file, and a plant with an average agreement under a
 * page that does not allow one.
 */

export const SEVERITY = Object.freeze({ ERROR: 'error', WARNING: 'warning' });

function problem(severity, code, detail, where) {
  return { severity, code, detail, where };
}

export function checkTracks(world) {
  const found = [];
  for (const track of world.tracks.all()) {
    if (!world.stations.has(track.splc)) {
      found.push(
        problem(SEVERITY.ERROR, 'track-station-missing', `no station ${track.splc}`, track.id)
      );
    }
    if (track.consigneeId !== undefined && !world.parties.has(track.consigneeId)) {
      found.push(
        problem(
          SEVERITY.ERROR,
          'track-consignee-missing',
          `no party ${track.consigneeId}`,
          track.id
        )
      );
    }
  }
  return found;
}

export function checkParties(world) {
  const found = [];
  for (const party of world.parties.all()) {
    if (party.averageAgreementId !== undefined && !world.agreements.has(party.averageAgreementId)) {
      found.push(
        problem(
          SEVERITY.ERROR,
          'agreement-missing',
          `no agreement ${party.averageAgreementId}`,
          party.id
        )
      );
    }
    for (const guarantor of party.responsibleFor) {
      if (!world.parties.has(guarantor)) {
        found.push(
          problem(SEVERITY.WARNING, 'guarantor-missing', `no party ${guarantor}`, party.id)
        );
      }
    }
    if (world.tracks.forConsignee(party.id).length === 0 && party.active) {
      found.push(problem(SEVERITY.WARNING, 'party-has-no-track', 'no track serves it', party.id));
    }
  }
  return found;
}

export function checkAgreements(world) {
  const found = [];
  for (const agreement of world.agreements.values()) {
    if (!world.parties.has(agreement.consigneeId)) {
      found.push(
        problem(
          SEVERITY.ERROR,
          'agreement-party-missing',
          `no party ${agreement.consigneeId}`,
          agreement.id
        )
      );
      continue;
    }
    const filings = world.tariffs
      .all()
      .filter((filing) => filing.consigneeId === agreement.consigneeId);
    if (filings.length > 0 && filings.every((filing) => !filing.page.averageAgreementAllowed)) {
      found.push(
        problem(
          SEVERITY.WARNING,
          'agreement-not-allowed',
          'no page filed for this consignee allows an average agreement',
          agreement.id
        )
      );
    }
  }
  return found;
}

export function checkTariffs(world) {
  const found = [];
  const carriers = new Set(world.stations.all().map((station) => station.carrier));
  for (const carrier of carriers) {
    if (world.tariffs.all().every((filing) => filing.carrier !== carrier)) {
      found.push(problem(SEVERITY.ERROR, 'carrier-has-no-tariff', 'no page on file', carrier));
    }
  }
  for (const filing of world.tariffs.all()) {
    if (filing.splc !== undefined && !world.stations.has(filing.splc)) {
      found.push(
        problem(
          SEVERITY.ERROR,
          'tariff-station-missing',
          `no station ${filing.splc}`,
          filing.page.id
        )
      );
    }
    if (filing.consigneeId !== undefined && !world.parties.has(filing.consigneeId)) {
      found.push(
        problem(
          SEVERITY.ERROR,
          'tariff-consignee-missing',
          `no party ${filing.consigneeId}`,
          filing.page.id
        )
      );
    }
  }
  return found;
}

/**
 * Equipment. Surfacing the leases and the scale tickets in a command turned up
 * two cross references nothing had ever checked: a car can name a lease that
 * was never filed, and a ticket can be filed against a car that is not on the
 * register. Both read as "no weight" and "no lease" downstream, which is
 * indistinguishable from the car simply not having one.
 */
export function checkEquipment(world) {
  const found = [];
  const byId = new Map(world.leases.map((entry) => [entry.id, entry]));
  for (const record of world.cars.all()) {
    if (record.leaseId !== undefined && !byId.has(record.leaseId)) {
      found.push(problem(SEVERITY.ERROR, 'lease-missing', `no lease ${record.leaseId}`, record.id));
    }
  }
  for (const ticket of world.scaleTickets) {
    if (!world.cars.has(ticket.carId)) {
      found.push(
        problem(
          SEVERITY.WARNING,
          'ticket-car-missing',
          `no car ${ticket.carId} on the register`,
          ticket.number
        )
      );
    }
  }
  for (const entry of world.leases) {
    if (world.cars.filter((record) => record.leaseId === entry.id).length === 0) {
      found.push(problem(SEVERITY.WARNING, 'lease-has-no-car', 'no car names it', entry.id));
    }
  }
  return found;
}

export function validateWorld(world) {
  requireObject(world, 'world');
  return [
    ...checkTracks(world),
    ...checkParties(world),
    ...checkAgreements(world),
    ...checkTariffs(world),
    ...checkEquipment(world),
  ].sort(
    (a, b) =>
      (a.severity === SEVERITY.ERROR ? 0 : 1) - (b.severity === SEVERITY.ERROR ? 0 : 1) ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
      (a.where < b.where ? -1 : 1)
  );
}

export function errorsOnly(problems) {
  return problems.filter((entry) => entry.severity === SEVERITY.ERROR);
}

export function isUsable(problems) {
  return errorsOnly(problems).length === 0;
}

export function validationRows(problems) {
  return problems.map((entry) => ({
    severity: entry.severity,
    code: entry.code,
    where: entry.where,
    detail: entry.detail,
  }));
}
