import { requireObject } from '../../core/guards.js';
import { add } from '../../core/money.js';
import { hireCharge } from '../../storage/perDiem.js';
import { reclaim, reclaimTerms, reclaimedShare } from '../../storage/reclaim.js';
import { isPrivateCar } from '../../equipment/car.js';
import { tripsByCar, tripMinutes } from '../../events/carTrip.js';
import { OUTPUT, keyValueBlock, plainMoney, renderRows } from '../format.js';
import { loadRun } from '../context.js';

/**
 * spurtally hire
 *
 * What the serving carrier paid to hold somebody else's cars, and how much of
 * it can be put back on the consignee.
 *
 * Both halves were library only. The rate book was loaded from the
 * configuration and read by nothing, and the reclaim rules had no caller at
 * all, so a plant could sit on a foreign boxcar for a fortnight and the hire
 * the carrier paid on it never appeared anywhere in this program.
 *
 * The hours are taken from the trip rather than from the detention. Hire runs
 * from the moment the carrier takes the car to the moment it hands it on, which
 * includes the days it sat in the yard before anyone placed it, and those are
 * exactly the days the consignee is not liable for.
 */

const COLUMNS = ['car', 'kind', 'heldHours', 'chargeableHours', 'hire', 'reclaimable', 'reclaimed'];

export function termsFrom(world) {
  const settings = world.settings.reclaim ?? {};
  return reclaimTerms(settings);
}

export function heldHoursFor(assessment, trips) {
  const forCar = trips.get(assessment.carId) ?? [];
  const measured = forCar.map(tripMinutes).filter((value) => value !== undefined);
  if (measured.length > 0) {
    return Math.ceil(measured.reduce((sum, value) => sum + value, 0) / 60);
  }
  const spans = assessment.detentions
    .filter((detention) => detention.span !== undefined)
    .map((detention) => detention.span.end - detention.span.start);
  if (spans.length === 0) {
    return 0;
  }
  return Math.ceil(spans.reduce((sum, value) => sum + value, 0) / 60);
}

export function hireRows(world, result, events) {
  const trips = tripsByCar(events);
  const terms = termsFrom(world);
  return result.assessments.map((assessment) => {
    const car = world.cars.find(assessment.carId);
    const rate = car === undefined ? undefined : world.hireRates.find(car.kind);
    const heldHours = heldHoursFor(assessment, trips);
    const chargeableHours = assessment.chargeableDays * 24;
    /**
     * A private car is the owner's, so the carrier pays no hire on it whatever
     * the rate book says. Falling through to the rate lookup reported it as "no
     * rate filed", which reads as a gap in the configuration rather than as the
     * answer.
     */
    if (car !== undefined && isPrivateCar(car) && !terms.appliesToPrivateCars) {
      return {
        car: assessment.carId,
        kind: car.kind,
        heldHours,
        chargeableHours,
        hire: 0,
        reclaimable: 0,
        reclaimed: 'not on hire',
      };
    }
    if (rate === undefined) {
      return {
        car: assessment.carId,
        kind: car?.kind ?? '',
        heldHours,
        chargeableHours,
        hire: 0,
        reclaimable: 0,
        reclaimed: 'no rate filed',
      };
    }
    const charge = hireCharge(rate, { hours: heldHours });
    const back = reclaim(terms, {
      carId: assessment.carId,
      hireCharge: charge,
      heldHours,
      chargeableHours,
      exclusions: assessment.counts.flatMap((count) => count.relief.applied),
      car,
    });
    return {
      car: assessment.carId,
      kind: car.kind,
      heldHours,
      chargeableHours,
      hire: charge.total,
      reclaimable: back.amount,
      reclaimed: back.reclaimable ? `${back.hours} h` : back.why,
    };
  });
}

export function hireBody(world, result, events, output = OUTPUT.TABLE) {
  requireObject(world, 'world');
  const rows = hireRows(world, result, events);
  const hire = add(...rows.map((row) => row.hire));
  const back = add(...rows.map((row) => row.reclaimable));
  if (output === OUTPUT.JSON) {
    return JSON.stringify({ period: result.period, hire, reclaimable: back, rows }, null, 2);
  }
  const table = rows.map((row) => ({
    ...row,
    hire: plainMoney(row.hire),
    reclaimable: plainMoney(row.reclaimable),
  }));
  if (output === OUTPUT.CSV) {
    return renderRows(table, OUTPUT.CSV, COLUMNS);
  }
  if (rows.length === 0) {
    return 'no cars to charge hire on';
  }
  return [
    renderRows(table, OUTPUT.TABLE, COLUMNS),
    '',
    keyValueBlock({
      hire: plainMoney(hire),
      reclaimable: plainMoney(back),
      share: reclaimedShare({ total: back }, hire),
      'private cars': world.cars.all().filter(isPrivateCar).length,
    }),
  ].join('\n');
}

export function runHire(options, deps = {}) {
  const { context, feed, result } = loadRun(options, deps);
  return {
    text: hireBody(context.world, result, feed.events, context.output),
    rows: hireRows(context.world, result, feed.events),
    result,
  };
}
