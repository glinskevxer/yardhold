import { NotFoundError, ValidationError } from '../core/errors.js';
import { requireArray, requireString } from '../core/guards.js';
import { compareDates, formatCivilDate, parseCivilDate } from '../time/civil.js';
import { tariff } from './tariff.js';

/**
 * The tariff book. Pages are filed against a carrier and optionally a station
 * and a consignee, and a page filed against a contract beats a public page.
 *
 * The date that selects the page is the day the car was placed, not the day the
 * invoice is cut. A page published in April cannot reach back and reprice a car
 * that was standing in March, which is exactly what a naive lookup on the
 * invoice date does.
 */

export const SCOPE_WEIGHT = Object.freeze({
  contract: 4,
  consignee: 3,
  station: 2,
  carrier: 1,
});

export function tariffFiling({
  page,
  effectiveFrom,
  effectiveTo,
  splc,
  consigneeId,
  contractId,
} = {}) {
  const built = page && page.ladder ? page : tariff(page);
  const from = parseCivilDate(requireString(effectiveFrom, 'effectiveFrom'));
  const to = effectiveTo === undefined ? undefined : parseCivilDate(effectiveTo);
  if (to !== undefined && compareDates(from, to) > 0) {
    throw new ValidationError('a filing cannot expire before it takes effect', { page: built.id });
  }
  const scope =
    contractId !== undefined
      ? 'contract'
      : consigneeId !== undefined
        ? 'consignee'
        : splc !== undefined
          ? 'station'
          : 'carrier';
  return Object.freeze({
    page: built,
    carrier: built.carrier,
    from,
    to,
    splc: splc === undefined ? undefined : requireString(splc, 'splc'),
    consigneeId:
      consigneeId === undefined
        ? undefined
        : requireString(consigneeId, 'consigneeId').toUpperCase(),
    contractId: contractId === undefined ? undefined : requireString(contractId, 'contractId'),
    scope,
    weight: SCOPE_WEIGHT[scope],
  });
}

function matches(filing, query) {
  if (filing.carrier !== query.carrier) {
    return false;
  }
  if (filing.splc !== undefined && filing.splc !== query.splc) {
    return false;
  }
  if (filing.consigneeId !== undefined && filing.consigneeId !== query.consigneeId) {
    return false;
  }
  if (filing.contractId !== undefined && filing.contractId !== query.contractId) {
    return false;
  }
  return true;
}

export function tariffBook(filings = []) {
  const all = requireArray(filings, 'filings').map((entry) =>
    entry.weight === undefined ? tariffFiling(entry) : entry
  );
  const book = {
    get size() {
      return all.length;
    },
    all() {
      return [...all];
    },
    filingsFor(query) {
      const carrier = requireString(query.carrier, 'carrier').toUpperCase();
      const day = typeof query.on === 'string' ? parseCivilDate(query.on) : query.on;
      if (day === undefined) {
        throw new ValidationError('a tariff lookup has to name the day the car was placed', {
          carrier,
        });
      }
      const consigneeId =
        query.consigneeId === undefined ? undefined : query.consigneeId.toUpperCase();
      return all
        .filter((filing) => matches(filing, { ...query, carrier, consigneeId }))
        .filter((filing) => compareDates(filing.from, day) <= 0)
        .filter((filing) => filing.to === undefined || compareDates(filing.to, day) >= 0)
        .sort((a, b) => b.weight - a.weight || compareDates(b.from, a.from));
    },
    find(query) {
      return book.filingsFor(query)[0];
    },
    resolve(query) {
      const found = book.find(query);
      if (found === undefined) {
        throw new NotFoundError(
          'tariff',
          `${query.carrier} on ${formatCivilDate(
            typeof query.on === 'string' ? parseCivilDate(query.on) : query.on
          )}`
        );
      }
      return found.page;
    },
    pageIds() {
      return [...new Set(all.map((filing) => filing.page.id))].sort();
    },
  };
  return book;
}

export function explainSelection(filing) {
  if (filing === undefined) {
    return 'no page on file';
  }
  const where = filing.contractId ?? filing.consigneeId ?? filing.splc ?? filing.carrier;
  return `${filing.page.id} filed against ${filing.scope} ${where} from ${formatCivilDate(filing.from)}`;
}
