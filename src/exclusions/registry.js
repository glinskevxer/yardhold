import { requireArray, requireObject } from '../core/guards.js';
import { mergePeriods, overlaps } from '../time/period.js';
import { appliesToCar, appliesToConsignee, appliesToStation, exclusion } from './exclusion.js';

/**
 * The exclusion register. Bulletins arrive station wide, consignee notices
 * arrive per plant and bad orders arrive per car, and a car standing through a
 * bad week is under several of them at once. The register hands back the ones
 * that could reach a given car; whether they actually do is the eligibility
 * rule's business and not this file's.
 */

export function exclusionRegistry(records = []) {
  const all = requireArray(records, 'records').map((record) =>
    record.span === undefined ? exclusion(record) : record
  );
  const registry = {
    get size() {
      return all.length;
    },
    add(record) {
      const built = record.span === undefined ? exclusion(record) : record;
      all.push(built);
      return built;
    },
    all() {
      return [...all].sort((a, b) => a.span.start - b.span.start || (a.id < b.id ? -1 : 1));
    },
    ofKind(kind) {
      return registry.all().filter((record) => record.kind === kind);
    },
    covering(span) {
      requireObject(span, 'span');
      return registry.all().filter((record) => overlaps(record.span, span));
    },
    forCar({ carId, splc, consigneeId, span } = {}) {
      return registry
        .all()
        .filter((record) => appliesToStation(record, splc))
        .filter((record) => appliesToCar(record, carId))
        .filter((record) => appliesToConsignee(record, consigneeId))
        .filter((record) => span === undefined || overlaps(record.span, span));
    },
    windows(query) {
      return mergePeriods(registry.forCar(query).map((record) => record.span));
    },
  };
  return registry;
}

export function totalRegisteredMinutes(registry) {
  return registry.all().reduce((sum, record) => sum + (record.span.end - record.span.start), 0);
}

export function groupByKind(registry) {
  const grouped = new Map();
  for (const record of registry.all()) {
    const list = grouped.get(record.kind);
    if (list) {
      list.push(record);
    } else {
      grouped.set(record.kind, [record]);
    }
  }
  return grouped;
}
