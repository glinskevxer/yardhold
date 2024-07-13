import { ConflictError, NotFoundError } from './errors.js';
import { requireArray, requireString } from './guards.js';

/**
 * Four registers were repeating the same twenty lines of has, get, find, all
 * and a duplicate check. This is that, once. Everything specific to a register
 * stays in the register: how a record is built, how its key is normalised, and
 * every slice that means something to that book alone.
 */

export function keyedBook({
  label,
  records = [],
  keyOf,
  build = (record) => record,
  normalizeKey = (key) => requireString(key, 'key'),
  onDuplicate = 'throw',
} = {}) {
  const byKey = new Map();

  function put(record) {
    const built = build(record);
    const key = keyOf(built);
    if (byKey.has(key) && onDuplicate === 'throw') {
      throw new ConflictError(`that ${label} is already in the book`, { key });
    }
    byKey.set(key, built);
    return built;
  }

  const book = {
    label,
    add: put,
    get size() {
      return byKey.size;
    },
    has(key) {
      return byKey.has(normalizeKey(key));
    },
    find(key) {
      return byKey.get(normalizeKey(key));
    },
    get(key) {
      const normalized = normalizeKey(key);
      const found = byKey.get(normalized);
      if (!found) {
        throw new NotFoundError(label, normalized);
      }
      return found;
    },
    keys() {
      return [...byKey.keys()].sort();
    },
    all() {
      return book.keys().map((key) => byKey.get(key));
    },
    filter(predicate) {
      return book.all().filter(predicate);
    },
    replace(record) {
      const built = build(record);
      const key = keyOf(built);
      if (!byKey.has(key)) {
        throw new NotFoundError(label, key);
      }
      byKey.set(key, built);
      return built;
    },
  };

  for (const record of requireArray(records, 'records')) {
    put(record);
  }
  return book;
}
