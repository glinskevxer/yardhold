import { requireObject, requireString } from '../core/guards.js';
import { add } from '../core/money.js';
import { rateForDay } from '../tariff/rateLadder.js';
import { laddersResetPerDetention } from '../tariff/tariff.js';
import { buildDetentions } from '../clock/detention.js';
import { countChargeableDays } from '../clock/chargeableDays.js';

/**
 * Assessing one car for one period.
 *
 * The ladder reset rule decides what the day index means, so it is read once
 * here and threaded through every detention. On a page that resets each
 * detention a car respotted three times walks up the first rung three times;
 * on a page that runs to the month it keeps climbing.
 */

export function assessCar({
  carId,
  events,
  page,
  calendar,
  trackBook,
  exclusions = [],
  query,
  until,
  startIndex = 1,
  extraFreeDays = 0,
} = {}) {
  requireString(carId, 'carId');
  requireObject(page, 'page');
  const detentions = buildDetentions(events, { page, trackBook, until });
  const resets = laddersResetPerDetention(page);
  /**
   * A bunching allowance belongs to the arrival, so it is spent once. It has to
   * land on the first detention that has a span rather than simply the first
   * one: a car held constructively with no notice has a detention that counts
   * nothing, and giving the bonus to that threw it away silently.
   */
  const bonusAt = detentions.findIndex((detention) => detention.span !== undefined);
  const lines = [];
  let index = startIndex;
  const counts = [];
  for (const detention of detentions) {
    const count = countChargeableDays(
      { ...detention, carId },
      {
        page,
        calendar,
        exclusions,
        query,
        startIndex: resets ? 1 : index,
        extraFreeDays: counts.length === bonusAt ? extraFreeDays : 0,
      }
    );
    counts.push(count);
    for (const unit of count.charged) {
      lines.push({
        carId,
        date: unit.label,
        dayIndex: unit.dayIndex,
        rate: rateForDay(page.ladder, unit.dayIndex),
        placement: detention.kind,
        trackId: detention.trackId,
      });
    }
    if (!resets) {
      index = count.nextIndex;
    }
  }
  const gross = add(...lines.map((line) => line.rate));
  return {
    carId,
    pageId: page.id,
    extraFreeDays,
    detentions,
    counts,
    lines,
    chargeableDays: lines.length,
    gross,
    total: gross === 0 ? 0 : Math.max(gross, page.minimumCharge),
    nextIndex: resets ? startIndex : index,
  };
}

export function assessmentTotal(assessment) {
  return assessment.total;
}

export function chargedDates(assessment) {
  return assessment.lines.map((line) => line.date);
}

export function reliefApplied(assessment) {
  return assessment.counts.flatMap((count) => count.relief.applied);
}

export function freeDaysUsed(assessment) {
  return assessment.counts.reduce((sum, count) => sum + count.freeUsed, 0);
}

export function hasCharge(assessment) {
  return assessment.total > 0;
}
