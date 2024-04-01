import { ValidationError } from '../core/errors.js';
import { optional, requireInteger, requireOneOf, requireString } from '../core/guards.js';
import { parseMoney } from '../core/money.js';
import { compareDates, dateRange, parseCivilDate, rangeContains } from '../time/civil.js';
import { parseQuantity, quantity } from '../core/quantity.js';

/**
 * Lease terms for a private car. A leased car still carries a private mark, so
 * it is still on the storage book, but the mileage allowance and the running
 * repair split come out of the lease rather than the tariff.
 */

export const LEASE_KIND = Object.freeze({
  FULL_SERVICE: 'full-service',
  NET: 'net',
  PER_DIEM: 'per-diem',
});

const KINDS = Object.values(LEASE_KIND);

export function lease({
  id,
  kind = LEASE_KIND.NET,
  lessee,
  lessor,
  from,
  to,
  monthlyRent = '0.00',
  mileageAllowance = '0',
  mileageRate = '0.0000',
  freeStorageDays = 0,
  repairSharePercent = 0,
} = {}) {
  requireString(id, 'id');
  requireOneOf(kind, KINDS, 'kind');
  requireString(lessee, 'lessee');
  requireString(lessor, 'lessor');
  const term = dateRange(requireString(from, 'from'), requireString(to, 'to'));
  const rent = parseMoney(monthlyRent);
  if (rent < 0) {
    throw new ValidationError('monthly rent cannot be negative', { id });
  }
  const allowance = parseQuantity(String(mileageAllowance), 0);
  const rate = parseQuantity(String(mileageRate), 4);
  if (allowance.units < 0 || rate.units < 0) {
    throw new ValidationError('mileage terms cannot be negative', { id });
  }
  return Object.freeze({
    id,
    kind,
    lessee,
    lessor,
    term,
    monthlyRent: rent,
    mileageAllowance: allowance,
    mileageRate: rate,
    freeStorageDays: requireInteger(freeStorageDays, 'freeStorageDays', { min: 0, max: 365 }),
    repairSharePercent: requireInteger(repairSharePercent, 'repairSharePercent', {
      min: 0,
      max: 100,
    }),
  });
}

export function isLeaseActive(record, date) {
  return rangeContains(record.term, typeof date === 'string' ? parseCivilDate(date) : date);
}

export function leaseExpired(record, date) {
  const day = typeof date === 'string' ? parseCivilDate(date) : date;
  return compareDates(day, record.term.to) > 0;
}

/** Miles above the allowance are billable; the allowance itself is not. */
export function billableMiles(record, milesRun) {
  const run = typeof milesRun === 'number' ? quantity(milesRun, 0) : milesRun;
  const excess = run.units - record.mileageAllowance.units;
  return quantity(Math.max(0, excess), 0);
}

export function selectLease(leases, date) {
  const day = typeof date === 'string' ? parseCivilDate(date) : date;
  const active = leases.filter((record) => isLeaseActive(record, day));
  if (active.length === 0) {
    return undefined;
  }
  return active.sort((a, b) => compareDates(b.term.from, a.term.from))[0];
}

export function describeLease(record) {
  return `${record.id} ${record.kind} ${record.lessee}`;
}

export function optionalLeaseId(value) {
  return optional(value, (id) => requireString(id, 'leaseId'));
}
