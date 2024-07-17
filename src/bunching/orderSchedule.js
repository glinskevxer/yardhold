import { ConflictError, ValidationError } from '../core/errors.js';
import { requireArray, requireInteger, requireString } from '../core/guards.js';
import { compareDates, daysBetween, formatCivilDate, parseCivilDate } from '../time/civil.js';

/**
 * What the consignee asked for.
 *
 * Bunching is only meaningful against an order. A plant that asked for two cars
 * a day for five days and got ten on Thursday has been bunched; a plant that
 * asked for ten on Thursday and got ten on Thursday has not, however hard the
 * week was. So the schedule is a first class record and the relief is computed
 * against it rather than against a guess about normal.
 */

export function carOrder({ consigneeId, splc, wantedOn, cars, commodityClass, reference } = {}) {
  requireString(consigneeId, 'consigneeId');
  requireString(splc, 'splc');
  const day = parseCivilDate(requireString(wantedOn, 'wantedOn'));
  requireInteger(cars, 'cars', { min: 1, max: 200 });
  return Object.freeze({
    consigneeId: consigneeId.trim().toUpperCase(),
    splc,
    wantedOn: day,
    cars,
    commodityClass:
      commodityClass === undefined ? undefined : requireString(commodityClass, 'commodityClass'),
    reference: reference === undefined ? undefined : requireString(reference, 'reference'),
  });
}

export function orderSchedule(orders = []) {
  const built = requireArray(orders, 'orders').map((entry) =>
    entry.wantedOn && entry.wantedOn.year ? entry : carOrder(entry)
  );
  const seen = new Set();
  for (const order of built) {
    const key = `${order.consigneeId}|${order.splc}|${formatCivilDate(order.wantedOn)}`;
    if (seen.has(key)) {
      throw new ConflictError('the schedule orders cars twice for the same day', { key });
    }
    seen.add(key);
  }
  const sorted = [...built].sort(
    (a, b) => compareDates(a.wantedOn, b.wantedOn) || (a.consigneeId < b.consigneeId ? -1 : 1)
  );
  const schedule = {
    get size() {
      return sorted.length;
    },
    all() {
      return [...sorted];
    },
    forConsignee(consigneeId) {
      const wanted = requireString(consigneeId, 'consigneeId').trim().toUpperCase();
      return sorted.filter((order) => order.consigneeId === wanted);
    },
    on(consigneeId, date) {
      const day = typeof date === 'string' ? parseCivilDate(date) : date;
      return schedule
        .forConsignee(consigneeId)
        .find((order) => compareDates(order.wantedOn, day) === 0);
    },
    carsOrderedOn(consigneeId, date) {
      return schedule.on(consigneeId, date)?.cars ?? 0;
    },
    window(consigneeId, from, to) {
      const start = typeof from === 'string' ? parseCivilDate(from) : from;
      const end = typeof to === 'string' ? parseCivilDate(to) : to;
      if (compareDates(start, end) > 0) {
        throw new ValidationError('a schedule window cannot end before it starts', {});
      }
      return schedule
        .forConsignee(consigneeId)
        .filter(
          (order) =>
            compareDates(order.wantedOn, start) >= 0 && compareDates(order.wantedOn, end) <= 0
        );
    },
    totalOrdered(consigneeId, from, to) {
      return schedule.window(consigneeId, from, to).reduce((sum, order) => sum + order.cars, 0);
    },
  };
  return schedule;
}

/** How many days early or late a car turned up against what was asked for. */
export function driftDays(order, placedOn) {
  const day = typeof placedOn === 'string' ? parseCivilDate(placedOn) : placedOn;
  return daysBetween(order.wantedOn, day);
}
