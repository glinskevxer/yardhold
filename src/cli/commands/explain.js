import { NotFoundError } from '../../core/errors.js';
import { requireString } from '../../core/guards.js';
import { normalizeCarId } from '../../equipment/reportingMarks.js';
import { ingestCsv } from '../../io/ingestEvents.js';
import { formatEvent } from '../../events/event.js';
import { assessMonth } from '../../assessment/runMonth.js';
import { explainSelection } from '../../tariff/tariffBook.js';
import { describeExclusion } from '../../exclusions/exclusion.js';
import { explainRefusal } from '../../exclusions/eligibility.js';
import { OUTPUT, keyValueBlock, plainMoney, renderRows } from '../format.js';
import { commandContext, readTextFile } from '../context.js';

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
    })),
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
        open: detention.open ? 'yes' : 'no',
      })),
      OUTPUT.TABLE
    )
  );
  sections.push('');
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

export function eventTrail(feed, carId) {
  const wanted = normalizeCarId(carId);
  return feed.events.filter((record) => record.carId === wanted).map(formatEvent);
}

export function runExplain(options, deps = {}) {
  const context = commandContext(options, deps);
  const feed = ingestCsv(readTextFile(options.events, deps), {
    offsetMinutes: context.world.settings.offsetMinutes,
  });
  const result = assessMonth(context.world, feed.events, {
    period: context.period,
    carrier: options.carrier,
  });
  const explanation = explainCar(context.world, result, options.car);
  const text =
    context.output === OUTPUT.JSON
      ? JSON.stringify(explanation, null, 2)
      : explainText(explanation, context.world);
  return { text, explanation, trail: eventTrail(feed, options.car) };
}
