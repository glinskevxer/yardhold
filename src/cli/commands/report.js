import { ValidationError } from '../../core/errors.js';
import { requireOneOf } from '../../core/guards.js';

import { exceptionReport, exceptionRows } from '../../reporting/exceptions.js';
import { assessmentKpis, reliefKpis } from '../../reporting/kpi.js';
import { dwellSummary, fromDetentions, toDays } from '../../reporting/dwell.js';
import { buildRegister, registerRows, registerText } from '../../reporting/register.js';
import { openTrips, repeatVisitors, tripMinutes, tripsByCar } from '../../events/carTrip.js';
import {
  averageOccupancy,
  fullDays,
  peakOccupancy,
  trackOccupancy,
  utilisation,
} from '../../site/capacity.js';
import {
  isDeemedAccepted,
  refusals,
  responsibleCarrier,
  timeAtJunctionMinutes,
} from '../../switching/interchange.js';
import { DEFAULT_OFFSET_MINUTES, dateAt, formatInstant } from '../../time/instant.js';
import { formatCivilDate } from '../../time/civil.js';
import { parseInstant } from '../../time/instant.js';
import { OUTPUT, keyValueBlock, plainMoney, renderRows } from '../format.js';
import { loadRun } from '../context.js';

/**
 * spurtally report
 *
 * Several reports behind one command because they are read together at month
 * end and nobody wants five invocations. Which one runs is an argument rather
 * than a subcommand, since they take the same inputs.
 *
 * Most of them read the assessment. `trips` reads the event feed directly,
 * because a trip is a fact about the stream rather than about the billing: a
 * car that arrived, was never placed and left again made a trip and has no
 * assessment at all.
 */

export const REPORT = Object.freeze({
  EXCEPTIONS: 'exceptions',
  KPI: 'kpi',
  DWELL: 'dwell',
  REGISTER: 'register',
  TRIPS: 'trips',
  CAPACITY: 'capacity',
  INTERCHANGE: 'interchange',
});

const REPORTS = Object.values(REPORT);

export function exceptionsBody(result, output) {
  const rows = exceptionRows(exceptionReport(result));
  if (rows.length === 0 && output === OUTPUT.TABLE) {
    return 'no exceptions';
  }
  return renderRows(rows, output, ['kind', 'car', 'detail']);
}

export function kpiBody(result, output) {
  const kpis = assessmentKpis(result.assessments);
  const relief = reliefKpis(result.assessments);
  if (output === OUTPUT.JSON) {
    return JSON.stringify({ period: result.period, ...kpis, relief }, null, 2);
  }
  const rows = {
    period: result.period,
    cars: kpis.cars,
    'cars with a clock': kpis.carsWithAClock,
    'cars over free time': kpis.carsOverFreeTime,
    'over free time share': `${Math.round(kpis.overFreeTimeShare * 1000) / 10}%`,
    'chargeable days': kpis.chargeableDays,
    'free days': kpis.freeDays,
    respots: kpis.respots,
    'relief applied': relief.applied,
    'relief declined': relief.declined,
    gross: plainMoney(kpis.gross),
  };
  if (output === OUTPUT.CSV) {
    return renderRows([rows], OUTPUT.CSV);
  }
  return keyValueBlock(rows);
}

export function dwellBody(result, output) {
  const rows = result.assessments.map((assessment) =>
    fromDetentions(assessment.carId, assessment.detentions, {
      arrivedAt: assessment.firstEventAt,
    })
  );
  const summary = dwellSummary(rows);
  if (output === OUTPUT.JSON) {
    return JSON.stringify({ period: result.period, rows, summary }, null, 2);
  }
  const table = rows.map((row) => ({
    car: row.carId,
    yard: toDays(row.yardMinutes) ?? '',
    plant: toDays(row.plantMinutes) ?? '',
    total: toDays(row.totalMinutes) ?? '',
  }));
  return renderRows(table, output, ['car', 'yard', 'plant', 'total']);
}

export function registerBody(result, output) {
  const register = buildRegister(result);
  if (output === OUTPUT.JSON) {
    return JSON.stringify(
      { period: register.period, days: register.days, rows: register.rows },
      null,
      2
    );
  }
  if (output === OUTPUT.CSV) {
    return renderRows(registerRows(register), OUTPUT.CSV, [
      'car',
      'consignee',
      'grid',
      'chargeable',
      'amount',
    ]);
  }
  return registerText(register);
}

export function tripRows(events, offsetMinutes = DEFAULT_OFFSET_MINUTES) {
  const rows = [];
  for (const [carId, trips] of tripsByCar(events)) {
    trips.forEach((trip, index) => {
      const minutes = tripMinutes(trip);
      rows.push({
        car: carId,
        trip: index + 1,
        arrived: trip.arrivedAt === undefined ? '' : formatInstant(trip.arrivedAt, offsetMinutes),
        departed: trip.open ? '' : formatInstant(trip.departedAt, offsetMinutes),
        days: minutes === undefined ? '' : Math.round((minutes / 1440) * 100) / 100,
        placements: trip.placements,
        tracks: trip.tracks.join(' '),
        open: trip.open ? 'yes' : 'no',
      });
    });
  }
  return rows.sort((a, b) => (a.car < b.car ? -1 : a.car > b.car ? 1 : a.trip - b.trip));
}

export function tripsBody(events, output, offsetMinutes) {
  const byCar = tripsByCar(events);
  const rows = tripRows(events, offsetMinutes);
  const all = [...byCar.values()].flat();
  if (output === OUTPUT.JSON) {
    return JSON.stringify(
      {
        cars: byCar.size,
        trips: rows.length,
        open: openTrips(all).length,
        repeatVisitors: repeatVisitors(byCar),
        rows,
      },
      null,
      2
    );
  }
  if (output === OUTPUT.CSV) {
    return renderRows(rows, OUTPUT.CSV, [
      'car',
      'trip',
      'arrived',
      'departed',
      'days',
      'placements',
      'tracks',
      'open',
    ]);
  }
  if (rows.length === 0) {
    return 'no trips in the feed';
  }
  const repeats = repeatVisitors(byCar);
  return [
    renderRows(rows, OUTPUT.TABLE, [
      'car',
      'trip',
      'arrived',
      'departed',
      'days',
      'placements',
      'tracks',
      'open',
    ]),
    '',
    keyValueBlock({
      cars: byCar.size,
      trips: rows.length,
      'still here': openTrips(all).length,
      'came back': repeats.length,
    }),
  ].join('\n');
}

/**
 * Every stand the assessment found, as a placed-and-released pair of civil
 * days. This is the shape `site/capacity.js` has always wanted and nothing had
 * ever handed it: an occupancy count is about which days a car sat on a track,
 * not about what it was charged for sitting there.
 */
export function placementRecords(result, offsetMinutes = DEFAULT_OFFSET_MINUTES) {
  return result.assessments.flatMap((assessment) =>
    assessment.detentions
      .filter((detention) => detention.trackId !== undefined && detention.placedAt !== undefined)
      .map((detention) => ({
        carId: assessment.carId,
        trackId: detention.trackId,
        placedOn: formatCivilDate(dateAt(detention.placedAt, offsetMinutes)),
        releasedOn:
          detention.releasedAt === undefined
            ? undefined
            : formatCivilDate(dateAt(detention.releasedAt, offsetMinutes)),
      }))
  );
}

export function capacityBody(world, result, output, offsetMinutes) {
  const placements = placementRecords(result, offsetMinutes);
  const window = { from: result.bounds.firstDay, to: result.bounds.lastDay };
  const tracks = world.tracks.all().filter((track) => track.role === 'industry');
  const summaries = tracks.map((track) => {
    const rows = trackOccupancy(track, placements, window);
    return {
      track: track.id,
      consignee: track.consigneeId ?? '',
      capacity: track.capacityCars,
      peak: peakOccupancy(rows),
      average: averageOccupancy(rows),
      utilisation: utilisation(rows),
      fullDays: fullDays(rows).length,
      rows,
    };
  });
  if (output === OUTPUT.JSON) {
    return JSON.stringify({ period: result.period, window, tracks: summaries }, null, 2);
  }
  const table = summaries.map((entry) => ({
    track: entry.track,
    consignee: entry.consignee,
    capacity: entry.capacity,
    peak: entry.peak,
    average: entry.average,
    utilisation: entry.utilisation,
    fullDays: entry.fullDays,
  }));
  if (output === OUTPUT.CSV) {
    return renderRows(table, OUTPUT.CSV, [
      'track',
      'consignee',
      'capacity',
      'peak',
      'average',
      'utilisation',
      'fullDays',
    ]);
  }
  if (table.length === 0) {
    return 'no industry track in the configuration';
  }
  const crowded = summaries.filter((entry) => entry.fullDays > 0);
  const lines = [
    renderRows(table, OUTPUT.TABLE, [
      'track',
      'consignee',
      'capacity',
      'peak',
      'average',
      'utilisation',
      'fullDays',
    ]),
  ];
  if (crowded.length > 0) {
    lines.push('');
    lines.push('full on');
    for (const entry of crowded) {
      lines.push(`  ${entry.track}  ${fullDays(entry.rows).join(' ')}`);
    }
  }
  return lines.join('\n');
}

/**
 * Who owned each car standing at a junction. The interchange rules had no
 * caller at all, so an office running this program could not answer the one
 * question a junction raises: an offer nobody answered inside the grace is
 * deemed accepted, and until it is, the hours belong to the carrier that
 * offered it rather than the one that will eventually take it.
 */
export function interchangeBody(world, output, offsetMinutes = DEFAULT_OFFSET_MINUTES, asOf) {
  const rows = world.interchanges.map((record) => ({
    car: record.carId,
    junction: record.junction,
    from: record.deliveringCarrier,
    to: record.receivingCarrier,
    offered: formatInstant(record.offeredAt, offsetMinutes),
    status: record.status,
    responsible: responsibleCarrier(record, asOf),
    hours: Math.round(timeAtJunctionMinutes(record, asOf) / 60),
    deemed: isDeemedAccepted(record, asOf) ? 'yes' : 'no',
  }));
  if (output === OUTPUT.JSON) {
    return JSON.stringify({ asOf, refused: refusals(world.interchanges).length, rows }, null, 2);
  }
  const columns = [
    'car',
    'junction',
    'from',
    'to',
    'offered',
    'status',
    'responsible',
    'hours',
    'deemed',
  ];
  if (output === OUTPUT.CSV) {
    return renderRows(rows, OUTPUT.CSV, columns);
  }
  if (rows.length === 0) {
    return 'no interchange on file';
  }
  return [
    renderRows(rows, OUTPUT.TABLE, columns),
    '',
    keyValueBlock({
      handovers: rows.length,
      refused: refusals(world.interchanges).length,
      'deemed accepted': rows.filter((row) => row.deemed === 'yes').length,
    }),
  ].join('\n');
}

export function reportBody(kind, result, output, { events = [], offsetMinutes, world, asOf } = {}) {
  requireOneOf(kind, REPORTS, 'report');
  if (kind === REPORT.EXCEPTIONS) {
    return exceptionsBody(result, output);
  }
  if (kind === REPORT.KPI) {
    return kpiBody(result, output);
  }
  if (kind === REPORT.REGISTER) {
    return registerBody(result, output);
  }
  if (kind === REPORT.TRIPS) {
    return tripsBody(events, output, offsetMinutes);
  }
  if (kind === REPORT.CAPACITY) {
    return capacityBody(world, result, output, offsetMinutes);
  }
  if (kind === REPORT.INTERCHANGE) {
    return interchangeBody(world, output, offsetMinutes, asOf);
  }
  return dwellBody(result, output);
}

export function runReport(options, deps = {}) {
  const kind = options.report ?? REPORT.EXCEPTIONS;
  if (!REPORTS.includes(kind)) {
    throw new ValidationError(`report has to be one of ${REPORTS.join(', ')}`, { report: kind });
  }
  const { context, feed, result } = loadRun(options, deps);
  return {
    text: reportBody(kind, result, context.output, {
      events: feed.events,
      offsetMinutes: context.world.settings.offsetMinutes,
      world: context.world,
      asOf:
        options.asOf === undefined
          ? undefined
          : parseInstant(options.asOf, context.world.settings.offsetMinutes),
    }),
    result,
    feed,
  };
}
