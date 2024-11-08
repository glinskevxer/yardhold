import { ConflictError, NotFoundError } from '../core/errors.js';
import { requireArray, requireString } from '../core/guards.js';
import { car, isPrivateCar, isRailroadCar } from './car.js';
import { compareCarIds, normalizeCarId } from './reportingMarks.js';

/**
 * The fleet register. Every car the office has ever handled is in here, because
 * an assessment months later still has to say what the car was. Records are
 * never edited in place; a change replaces the record and the old one is kept
 * so a reopened claim can be recomputed against what was known at the time.
 */

export function fleet(records = []) {
  const byId = new Map();
  const history = new Map();
  const register = {
    add(record) {
      const built = Object.isFrozen(record) && record.kind ? record : car(record);
      if (byId.has(built.id)) {
        throw new ConflictError('that car is already registered', { id: built.id });
      }
      byId.set(built.id, built);
      history.set(built.id, [built]);
      return built;
    },
    replace(record) {
      const built = Object.isFrozen(record) && record.kind ? record : car(record);
      if (!byId.has(built.id)) {
        throw new NotFoundError('car', built.id);
      }
      byId.set(built.id, built);
      history.get(built.id).push(built);
      return built;
    },
    upsert(record) {
      const built = Object.isFrozen(record) && record.kind ? record : car(record);
      return byId.has(built.id) ? register.replace(built) : register.add(built);
    },
    has(id) {
      return byId.has(normalizeCarId(requireString(id, 'id')));
    },
    get(id) {
      const key = normalizeCarId(requireString(id, 'id'));
      const found = byId.get(key);
      if (!found) {
        throw new NotFoundError('car', key);
      }
      return found;
    },
    find(id) {
      return byId.get(normalizeCarId(requireString(id, 'id')));
    },
    versionsOf(id) {
      const key = normalizeCarId(requireString(id, 'id'));
      return [...(history.get(key) ?? [])];
    },
    get size() {
      return byId.size;
    },
    ids() {
      return [...byId.keys()].sort(compareCarIds);
    },
    all() {
      return register.ids().map((id) => byId.get(id));
    },
    filter(predicate) {
      return register.all().filter(predicate);
    },
    ofKind(kind) {
      return register.filter((record) => record.kind === kind);
    },
    ofMark(mark) {
      const wanted = requireString(mark, 'mark').toUpperCase();
      return register.filter((record) => record.mark === wanted);
    },
    railroadCars() {
      return register.filter(isRailroadCar);
    },
    privateCars() {
      return register.filter(isPrivateCar);
    },
  };
  for (const record of requireArray(records, 'records')) {
    register.add(record);
  }
  return register;
}

export function fleetSummary(register) {
  const kinds = new Map();
  for (const record of register.all()) {
    kinds.set(record.kind, (kinds.get(record.kind) ?? 0) + 1);
  }
  return {
    total: register.size,
    railroad: register.railroadCars().length,
    private: register.privateCars().length,
    byKind: Object.fromEntries([...kinds.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}
