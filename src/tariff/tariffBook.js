import { NotFoundError, ValidationError } from '../core/errors.js';
import { requireArray, requireString } from '../core/guards.js';
import { compareDates, formatCivilDate, parseCivilDate } from '../time/civil.js';
import { tariff } from './tariff.js';
import { pageAsAmended, supplementSeries } from './amendment.js';
import { inForceOn } from './effectivity.js';

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
  /**
   * A page that has been through `tariff()` carries a built ladder rather than
   * the array it was written as. Testing for frozen alone let a frozen literal
   * straight through and the ladder blew up four calls later.
   */
  const built =
    page !== undefined && page.ladder !== undefined && !Array.isArray(page.ladder)
      ? page
      : tariff(page);
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

export function tariffBook(filings = [], supplements = []) {
  const all = requireArray(filings, 'filings').map((entry) =>
    entry.weight === undefined ? tariffFiling(entry) : entry
  );
  const series = supplementSeries(supplements);
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
      return inForceOn(
        all.filter((filing) => matches(filing, { ...query, carrier, consigneeId })),
        day
      ).sort((a, b) => b.weight - a.weight || compareDates(b.from, a.from));
    },
    find(query) {
      return book.filingsFor(query)[0];
    },
    /**
     * The page as it stood on the day, supplements and all. A caller that
     * wants only what was originally filed can read `find().page`, and nothing
     * in the engine does.
     */
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
      const day = typeof query.on === 'string' ? parseCivilDate(query.on) : query.on;
      return pageAsAmended(found.page, series, day).page;
    },
    amendmentsOn(query) {
      const found = book.find(query);
      if (found === undefined) {
        return [];
      }
      const day = typeof query.on === 'string' ? parseCivilDate(query.on) : query.on;
      return pageAsAmended(found.page, series, day).applied;
    },
    supplements() {
      return [...series];
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
