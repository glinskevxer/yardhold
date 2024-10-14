import { describe, expect, it } from 'vitest';
import {
  EMPTY_DOCUMENT,
  SECTIONS,
  checkDocument,
  parseDocument,
  sectionCounts,
  settingsOf,
} from '../../src/config/schema.js';
import { ValidationError } from '../../src/core/errors.js';

const minimal = { stations: [], tracks: [], parties: [], tariffs: [] };

describe('checkDocument', () => {
  it('accepts the four required sections', () => {
    expect(checkDocument(minimal)).toBe(minimal);
  });

  it('names a section that is missing', () => {
    try {
      checkDocument({ stations: [], tracks: [], parties: [] });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.details.section).toBe('tariffs');
    }
  });

  it('refuses a section it has never heard of', () => {
    try {
      checkDocument({ ...minimal, stationz: [] });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.details.unknown).toEqual(['stationz']);
    }
  });

  it('refuses a section that is not an array', () => {
    expect(() => checkDocument({ ...minimal, orders: {} })).toThrow(ValidationError);
  });

  it('accepts every optional section', () => {
    const full = Object.fromEntries(SECTIONS.map((section) => [section, []]));
    expect(() => checkDocument(full)).not.toThrow();
  });

  it('allows a settings object', () => {
    expect(() => checkDocument({ ...minimal, settings: { termsDays: 30 } })).not.toThrow();
    expect(() => checkDocument({ ...minimal, settings: [] })).toThrow(ValidationError);
  });

  it('refuses something that is not an object at all', () => {
    expect(() => checkDocument([])).toThrow(ValidationError);
    expect(() => checkDocument(null)).toThrow(ValidationError);
  });
});

describe('settingsOf', () => {
  it('fills in the defaults', () => {
    expect(settingsOf(minimal)).toEqual({
      offsetMinutes: -360,
      termsDays: 15,
      taxRateBasisPoints: 0,
      years: [],
      invoicePrefix: 'INV',
    });
  });

  it('takes what the document gave', () => {
    const settings = settingsOf({ ...minimal, settings: { termsDays: 30, years: [2024] } });
    expect(settings.termsDays).toBe(30);
    expect(settings.years).toEqual([2024]);
    expect(settings.offsetMinutes).toBe(-360);
  });
});

describe('sectionCounts', () => {
  it('reports zero for every section that is absent', () => {
    const counts = sectionCounts(minimal);
    expect(counts.stations).toBe(0);
    expect(counts.orders).toBe(0);
    expect(Object.keys(counts).sort()).toEqual([...SECTIONS].sort());
  });

  it('counts what is there', () => {
    expect(sectionCounts({ ...minimal, stations: [1, 2, 3] }).stations).toBe(3);
  });
});

describe('parseDocument', () => {
  it('reads JSON and checks it', () => {
    expect(parseDocument(JSON.stringify(minimal)).tariffs).toEqual([]);
  });

  it('says so when the JSON is broken', () => {
    expect(() => parseDocument('{ not json')).toThrow(/not valid JSON/);
  });

  it('still checks the sections after parsing', () => {
    expect(() => parseDocument('{"stations":[]}')).toThrow(/missing a required section/);
  });

  it('refuses a non string', () => {
    expect(() => parseDocument(null)).toThrow(ValidationError);
  });
});

describe('EMPTY_DOCUMENT', () => {
  it('passes its own check', () => {
    expect(() => checkDocument(EMPTY_DOCUMENT)).not.toThrow();
  });
});
