import { NotFoundError, ValidationError } from '../core/errors.js';
import { requireArray, requireString } from '../core/guards.js';

/**
 * Commodities, keyed on the STCC the waybill carries.
 *
 * The code is seven digits and it is hierarchical, so a lookup that misses on
 * the full code falls back to the five digit group and then the two digit
 * section. That fallback is what lets a tariff write one line for grain rather
 * than four hundred lines for every kind of grain, and it is also how a new
 * commodity nobody has filed a line for still gets a sensible free time.
 */

const STCC_PATTERN = /^\d{7}$/;

export function stcc(text) {
  const value = requireString(text, 'stcc').replace(/[\s-]/g, '');
  if (!STCC_PATTERN.test(value)) {
    throw new ValidationError('an STCC is seven digits', { text });
  }
  return value;
}

export function commodity({
  code,
  name,
  commodityClass,
  hazmat = false,
  requiresHeat = false,
} = {}) {
  const key = stcc(code);
  requireString(name, 'name');
  requireString(commodityClass, 'commodityClass');
  return Object.freeze({
    code: key,
    name,
    commodityClass: commodityClass.toUpperCase(),
    hazmat: hazmat === true,
    requiresHeat: requiresHeat === true,
    section: key.slice(0, 2),
    group: key.slice(0, 5),
  });
}

export function commodityBook(entries = []) {
  const byCode = new Map();
  const byGroup = new Map();
  const bySection = new Map();
  for (const entry of requireArray(entries, 'entries')) {
    const built = Object.isFrozen(entry) && entry.section ? entry : commodity(entry);
    byCode.set(built.code, built);
    if (!byGroup.has(built.group)) {
      byGroup.set(built.group, built);
    }
    if (!bySection.has(built.section)) {
      bySection.set(built.section, built);
    }
  }
  const book = {
    get size() {
      return byCode.size;
    },
    find(code) {
      const key = stcc(code);
      return byCode.get(key) ?? byGroup.get(key.slice(0, 5)) ?? bySection.get(key.slice(0, 2));
    },
    get(code) {
      const found = book.find(code);
      if (found === undefined) {
        throw new NotFoundError('commodity', stcc(code));
      }
      return found;
    },
    exact(code) {
      return byCode.get(stcc(code));
    },
    classOf(code) {
      return book.find(code)?.commodityClass;
    },
    all() {
      return [...byCode.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
    },
    ofClass(commodityClass) {
      const wanted = requireString(commodityClass, 'commodityClass').toUpperCase();
      return book.all().filter((entry) => entry.commodityClass === wanted);
    },
    hazmat() {
      return book.all().filter((entry) => entry.hazmat);
    },
  };
  return book;
}

export function matchLevel(book, code) {
  const key = stcc(code);
  if (book.exact(key) !== undefined) {
    return 'exact';
  }
  const found = book.find(key);
  if (found === undefined) {
    return 'none';
  }
  return found.group === key.slice(0, 5) ? 'group' : 'section';
}

export const STANDARD_COMMODITIES = Object.freeze([
  { code: '0113210', name: 'corn', commodityClass: 'GRAIN' },
  { code: '0113710', name: 'soybeans', commodityClass: 'GRAIN' },
  { code: '2812340', name: 'sodium hydroxide solution', commodityClass: 'HAZ', hazmat: true },
  { code: '2818142', name: 'phenol', commodityClass: 'HAZ', hazmat: true, requiresHeat: true },
  { code: '3241110', name: 'portland cement', commodityClass: 'CEMENT' },
  { code: '4021110', name: 'flour', commodityClass: 'FOOD' },
]);
