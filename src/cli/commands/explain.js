import { NotFoundError } from '../../core/errors.js';
import { requireString } from '../../core/guards.js';
import { normalizeCarId } from '../../equipment/reportingMarks.js';
import { formatEvent } from '../../events/event.js';
import { explainSelection } from '../../tariff/tariffBook.js';
import { describeExclusion } from '../../exclusions/exclusion.js';
import { explainRefusal } from '../../exclusions/eligibility.js';
import { OUTPUT, keyValueBlock, plainMoney, renderRows } from '../format.js';
import { loadRun } from '../context.js';

/**
 * spurtally explain
 *
 * The command that settles arguments. It says which page was picked and why,
 * which days were free, which were charged, which relief was applied and, most
 * usefully of all, which relief was turned down and on what ground. Nearly
 * every dispute this office has had was answered by the last of those.
 */

export function explainCar(world, result, carId, { filing } = {}) {
  const wanted = normalizeCarId(requireString(carId, 'carId'));
  const assessment = result.assessments.find((entry) => entry.carId === wanted);
  if (assessment === undefined) {
    const skipped = result.skipped.find((entry) => entry.carId === wanted);
    throw new NotFoundError(
      'assessed car',
      skipped === undefined ? wanted : `${wanted}: ${skipped.why}`
    );
  }
  const counts = assessment.counts;
  return {
    carId: wanted,
    consigneeId: assessment.consigneeId,
    splc: assessment.splc,
    page: assessment.pageId,
    selection: explainSelection(filing),
    detentions: assessment.detentions.map((detention) => ({
      placement: detention.kind,
      track: detention.trackId ?? '',
      startsAt: detention.startsAt,
      releasedAt: detention.releasedAt,
      open: detention.open,
      state: detention.superseded ? 'superseded' : detention.open ? 'still here' : 'released',
    })),
    bunchingDays: assessment.extraFreeDays ?? 0,
    freeDays: counts.flatMap((count) => count.free.map((unit) => unit.label)),
    chargedDays: counts.flatMap((count) => count.charged.map((unit) => unit.label)),
    skippedDays: counts.flatMap((count) => count.skipped.map((unit) => unit.label)),
    reliefApplied: counts.flatMap((count) => count.relief.applied.map(describeExclusion)),
    reliefDeclined: counts.flatMap((count) =>
      count.relief.declined.map((record) => describeExclusion(record))
    ),
    total: assessment.total,
  };
}

export function explainText(explanation, world) {
  const header = keyValueBlock(
    {
      car: explanation.carId,
      consignee: explanation.consigneeId ?? '',
      station: explanation.splc,
      page: explanation.page,
      selected: explanation.selection,
      total: plainMoney(explanation.total),
    },
    ['car', 'consignee', 'station', 'page', 'selected', 'total']
  );
  const sections = [header, ''];
  sections.push('detentions');
  sections.push(
    renderRows(
      explanation.detentions.map((detention) => ({
        placement: detention.placement,
        track: detention.track,
        state: detention.state,
      })),
      OUTPUT.TABLE
    )
  );
  sections.push('');
  if (explanation.bunchingDays > 0) {
    sections.push(
      `bunching    ${explanation.bunchingDays} extra free day(s), the car filled an older order`
    );
  }
  sections.push(`free days   ${explanation.freeDays.join(' ') || 'none'}`);
  sections.push(`charged     ${explanation.chargedDays.join(' ') || 'none'}`);
  if (explanation.skippedDays.length > 0) {
    sections.push(`not counted ${explanation.skippedDays.join(' ')}`);
  }
  if (explanation.reliefApplied.length > 0) {
    sections.push('', 'relief applied', ...explanation.reliefApplied.map((line) => `  ${line}`));
  }
  if (explanation.reliefDeclined.length > 0) {
    sections.push('', 'relief declined', ...explanation.reliefDeclined.map((line) => `  ${line}`));
  }
  if (world !== undefined && explanation.reliefDeclined.length > 0) {
    sections.push(`  ${explainRefusal('wrong-placement')}`);
  }
  return sections.join('\n');
}

export function filingFor(world, result, carId, carrier) {
  const wanted = normalizeCarId(requireString(carId, 'carId'));
  const assessment = result.assessments.find((entry) => entry.carId === wanted);
  if (assessment === undefined || carrier === undefined) {
    return undefined;
  }
  return world.tariffs.find({
    carrier,
    splc: assessment.splc,
    consigneeId: assessment.consigneeId,
    on: result.bounds.firstDay,
  });
}

export function eventTrail(feed, carId) {
  const wanted = normalizeCarId(carId);
  return feed.events.filter((record) => record.carId === wanted).map(formatEvent);
}

export function runExplain(options, deps = {}) {
  const { context, feed, result } = loadRun(options, deps);
  /**
   * The filing has to be resolved and handed in, or the explanation prints "no
   * page on file" directly under the page it just used. Nobody reading that
   * believes the rest of the page.
   */
  const explanation = explainCar(context.world, result, options.car, {
    filing: filingFor(context.world, result, options.car, options.carrier),
  });
  const text =
    context.output === OUTPUT.JSON
      ? JSON.stringify(explanation, null, 2)
      : explainText(explanation, context.world);
  return { text, explanation, trail: eventTrail(feed, options.car) };
}
