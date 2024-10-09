import { requireArray } from '../core/guards.js';
import { MINUTES_PER_DAY } from '../time/instant.js';

/**
 * Dwell.
 *
 * Three different numbers get called dwell and a plant manager will use
 * whichever one is kindest, so all three are reported side by side:
 *
 *   yard dwell     arrival to placement, which is the carrier's to answer for
 *   plant dwell    placement to release, which is the consignee's
 *   total dwell    arrival to pull, which is the only one the shipper feels
 *
 * They do not add up, because a car can be released and sit unpulled for two
 * days, and that stretch belongs to nobody until somebody asks.
 */

export function dwellForCar({ carId, arrivedAt, placedAt, releasedAt, pulledAt } = {}) {
  const yard = arrivedAt !== undefined && placedAt !== undefined ? placedAt - arrivedAt : undefined;
  const plant =
    placedAt !== undefined && releasedAt !== undefined ? releasedAt - placedAt : undefined;
  const idle =
    releasedAt !== undefined && pulledAt !== undefined ? pulledAt - releasedAt : undefined;
  const total =
    arrivedAt !== undefined && pulledAt !== undefined ? pulledAt - arrivedAt : undefined;
  return { carId, yardMinutes: yard, plantMinutes: plant, idleMinutes: idle, totalMinutes: total };
}

export function fromDetentions(carId, detentions, { arrivedAt, pulledAt } = {}) {
  if (detentions.length === 0) {
    return dwellForCar({ carId, arrivedAt, pulledAt });
  }
  return dwellForCar({
    carId,
    arrivedAt,
    placedAt: detentions[0].placedAt,
    releasedAt: detentions[detentions.length - 1].releasedAt,
    pulledAt,
  });
}

function collect(rows, field) {
  return rows.map((row) => row[field]).filter((value) => value !== undefined);
}

export function meanMinutes(values) {
  if (values.length === 0) {
    return undefined;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round(total / values.length);
}

export function medianMinutes(values) {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function percentileMinutes(values, percentile) {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentile / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export function dwellSummary(rows) {
  requireArray(rows, 'rows');
  const summary = {};
  for (const field of ['yardMinutes', 'plantMinutes', 'idleMinutes', 'totalMinutes']) {
    const values = collect(rows, field);
    summary[field] = {
      cars: values.length,
      mean: meanMinutes(values),
      median: medianMinutes(values),
      ninetieth: percentileMinutes(values, 90),
    };
  }
  return summary;
}

export function toDays(minutes) {
  return minutes === undefined ? undefined : Math.round((minutes / MINUTES_PER_DAY) * 100) / 100;
}

export function worstDwell(rows, field = 'totalMinutes') {
  return rows
    .filter((row) => row[field] !== undefined)
    .sort((a, b) => b[field] - a[field])
    .slice(0, 10);
}
