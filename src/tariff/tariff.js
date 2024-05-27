import { ValidationError } from '../core/errors.js';
import { requireArray, requireInteger, requireOneOf, requireString } from '../core/guards.js';
import { parseMoney } from '../core/money.js';
import { COUNT_BASIS } from '../time/dayCount.js';
import { STANDARD_HOLIDAYS } from '../time/holidays.js';
import { DAY_KIND, SERVICE, freeDays, freeTimeDayKind, freeTimeTable } from './freeTimeTable.js';
import { LADDER_RESET, rateLadder } from './rateLadder.js';

/**
 * A tariff page as this office reads it.
 *
 * The page is not a bag of settings. Two of its fields decide what every other
 * rule in the system is measuring:
 *
 *   countBasis      whether a day ends at midnight or 24 hours after placement
 *   excludeDayKind  whether an excluded stretch is removed as whole days or as
 *                   the minutes it actually covered
 *
 * Everything downstream reads them off the page rather than assuming.
 */

const BASES = Object.values(COUNT_BASIS);
const DAY_KINDS = Object.values(DAY_KIND);

export function tariff({
  id,
  carrier,
  title,
  countBasis = COUNT_BASIS.CALENDAR_DAY,
  freeTime = [],
  ladder,
  excludeDayKind = DAY_KIND.RUNNING,
  holidayRules = STANDARD_HOLIDAYS,
  observesHolidays = true,
  creditsWeekends = false,
  notificationRequired = true,
  noticeGraceMinutes = 0,
  bunchingRelief = false,
  minimumCharge = '0.00',
  storageLadder,
  averageAgreementAllowed = false,
} = {}) {
  requireString(id, 'id');
  requireString(carrier, 'carrier');
  requireOneOf(countBasis, BASES, 'countBasis');
  requireOneOf(excludeDayKind, DAY_KINDS, 'excludeDayKind');
  requireArray(holidayRules, 'holidayRules');
  requireInteger(noticeGraceMinutes, 'noticeGraceMinutes', { min: 0, max: 2880 });
  const table = Array.isArray(freeTime) ? freeTimeTable(freeTime) : freeTime;
  const charged =
    ladder === undefined ? undefined : Array.isArray(ladder) ? rateLadder(ladder) : ladder;
  if (charged === undefined) {
    throw new ValidationError('a tariff page needs a rate ladder', { id });
  }
  const storage =
    storageLadder === undefined
      ? undefined
      : Array.isArray(storageLadder)
        ? rateLadder(storageLadder)
        : storageLadder;
  if (!observesHolidays && creditsWeekends === false && excludeDayKind === DAY_KIND.SERVICE) {
    throw new ValidationError(
      'a page that counts service days has to say which days are not service days',
      { id }
    );
  }
  return Object.freeze({
    id,
    carrier: carrier.trim().toUpperCase(),
    title: title === undefined ? id : requireString(title, 'title'),
    countBasis,
    freeTime: table,
    ladder: charged,
    storageLadder: storage,
    excludeDayKind,
    holidayRules: Object.freeze([...holidayRules]),
    observesHolidays: observesHolidays === true,
    creditsWeekends: creditsWeekends === true,
    notificationRequired: notificationRequired === true,
    noticeGraceMinutes,
    bunchingRelief: bunchingRelief === true,
    minimumCharge: parseMoney(String(minimumCharge)),
    averageAgreementAllowed: averageAgreementAllowed === true,
  });
}

export function freeTimeFor(page, query) {
  return freeDays(page.freeTime, query, 0);
}

export function freeTimeCountsServiceDays(page, query) {
  return freeTimeDayKind(page.freeTime, query) === DAY_KIND.SERVICE;
}

export function countsInWholeDays(page) {
  return page.excludeDayKind === DAY_KIND.RUNNING;
}

export function laddersResetPerDetention(page) {
  return page.ladder.reset === LADDER_RESET.DETENTION;
}

export function chargeableUnitOptions(page) {
  return {
    basis: page.countBasis,
    countPartialFirst: page.countBasis === COUNT_BASIS.CALENDAR_DAY ? false : true,
    countPartialLast: true,
  };
}

export function describeTariff(page) {
  return `${page.carrier} ${page.id} ${page.title}`;
}

export const DEFAULT_SERVICES = Object.freeze([SERVICE.LOADING, SERVICE.UNLOADING]);
