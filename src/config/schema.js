import { ValidationError } from '../core/errors.js';
import { requireArray, requireObject, requireString } from '../core/guards.js';

/**
 * The shape of a configuration document.
 *
 * Checked before anything is built, because a typo in a section name silently
 * produces an empty book and an invoice for nothing, which is far worse than a
 * loud refusal at start up.
 */

export const SECTIONS = Object.freeze([
  'stations',
  'tracks',
  'parties',
  'calendars',
  'tariffs',
  'switchRates',
  'agreements',
  'orders',
  'exclusions',
  'hireRates',
  'cars',
  'commodities',
  'waybills',
  'supplements',
  'leases',
  'scaleTickets',
]);

const REQUIRED = Object.freeze(['stations', 'tracks', 'parties', 'tariffs']);

export function checkDocument(document) {
  requireObject(document, 'config');
  const unknown = Object.keys(document).filter(
    (key) => !SECTIONS.includes(key) && key !== 'settings'
  );
  if (unknown.length > 0) {
    throw new ValidationError('the configuration names a section that does not exist', {
      unknown: unknown.sort(),
      known: SECTIONS,
    });
  }
  for (const section of REQUIRED) {
    if (document[section] === undefined) {
      throw new ValidationError('the configuration is missing a required section', { section });
    }
  }
  for (const section of SECTIONS) {
    if (document[section] !== undefined) {
      requireArray(document[section], section);
    }
  }
  if (document.settings !== undefined) {
    requireObject(document.settings, 'settings');
  }
  return document;
}

export function settingsOf(document) {
  const settings = document.settings ?? {};
  return {
    offsetMinutes: settings.offsetMinutes ?? -360,
    termsDays: settings.termsDays ?? 15,
    taxRateBasisPoints: settings.taxRateBasisPoints ?? 0,
    years: settings.years ?? [],
    invoicePrefix: settings.invoicePrefix ?? 'INV',
  };
}

export function sectionCounts(document) {
  const counts = {};
  for (const section of SECTIONS) {
    counts[section] = (document[section] ?? []).length;
  }
  return counts;
}

export function parseDocument(text) {
  requireString(text, 'text');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ValidationError('the configuration is not valid JSON', { detail: error.message });
  }
  return checkDocument(parsed);
}

export const EMPTY_DOCUMENT = Object.freeze({
  stations: [],
  tracks: [],
  parties: [],
  tariffs: [],
});
