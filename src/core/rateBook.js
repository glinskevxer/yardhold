import { NotFoundError } from './errors.js';
import { requireArray } from './guards.js';

/**
 * Three rate tables were each carrying their own copy of find, rateFor, kinds
 * and a last-one-wins loop. This is that loop, once. A later entry replacing an
 * earlier one is deliberate and shared: rate sheets are read top to bottom and
 * an amendment is filed under the same key.
 */

export function rateBook({ label, rates = [], keyOf, build = (entry) => entry } = {}) {
  const byKey = new Map();
  for (const entry of requireArray(rates, 'rates')) {
    const built = build(entry);
    byKey.set(keyOf(built), built);
  }
  const book = {
    label,
    get size() {
      return byKey.size;
    },
    find(key) {
      return byKey.get(key);
    },
    rateFor(key) {
      const found = byKey.get(key);
      if (found === undefined) {
        throw new NotFoundError(label, key);
      }
      return found;
    },
    keys() {
      return [...byKey.keys()].sort();
    },
    all() {
      return book.keys().map((key) => byKey.get(key));
    },
  };
  return book;
}
