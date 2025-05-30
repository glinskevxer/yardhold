import { describe, expect, it } from 'vitest';
import {
  SEVERITY,
  checkAgreements,
  checkParties,
  checkTariffs,
  checkTracks,
  errorsOnly,
  isUsable,
  validateWorld,
  validationRows,
} from '../../src/config/validate.js';
import { loadConfig } from '../../src/config/loadConfig.js';
import { SERVICE } from '../../src/tariff/freeTimeTable.js';
import { ValidationError } from '../../src/core/errors.js';

const page = (id, extra = {}) => ({
  id,
  carrier: 'BNSF',
  ladder: [{ fromDay: 1, rate: '150.00' }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
  ...extra,
});

const sound = {
  settings: { years: [2024] },
  stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
  tracks: [
    { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
  ],
  parties: [
    {
      id: 'DELTA',
      name: 'Delta Chemical',
      noticeAddress: 'a@b.example',
      averageAgreementId: 'AVG-1',
    },
  ],
  agreements: [{ id: 'AVG-1', consigneeId: 'DELTA', from: '2024-01-01', to: '2024-12-31' }],
  tariffs: [
    {
      page: page('CON-DELTA', { averageAgreementAllowed: true }),
      effectiveFrom: '2024-01-01',
      consigneeId: 'DELTA',
    },
  ],
};

describe('a sound configuration', () => {
  const world = loadConfig(sound);

  it('has nothing to say about it', () => {
    expect(validateWorld(world)).toEqual([]);
    expect(isUsable(validateWorld(world))).toBe(true);
  });

  it('needs a world', () => {
    expect(() => validateWorld(undefined)).toThrow(ValidationError);
  });
});

describe('checkTracks', () => {
  it('catches a track at a station nobody entered', () => {
    const world = loadConfig({
      ...sound,
      tracks: [{ ...sound.tracks[0], splc: '999999' }],
    });
    const found = checkTracks(world);
    expect(found[0].code).toBe('track-station-missing');
    expect(found[0].where).toBe('IT-9');
  });

  it('catches a track for a consignee nobody entered', () => {
    const world = loadConfig({
      ...sound,
      tracks: [{ ...sound.tracks[0], consigneeId: 'NOBODY' }],
    });
    expect(checkTracks(world).some((entry) => entry.code === 'track-consignee-missing')).toBe(true);
  });
});

describe('checkParties', () => {
  it('catches an agreement that is not in the book', () => {
    const world = loadConfig({ ...sound, agreements: [] });
    const found = checkParties(world);
    expect(found.some((entry) => entry.code === 'agreement-missing')).toBe(true);
  });

  it('warns about a guarantor nobody entered', () => {
    const world = loadConfig({
      ...sound,
      parties: [{ ...sound.parties[0], responsibleFor: ['NOBODY'] }],
    });
    const found = checkParties(world).filter((entry) => entry.code === 'guarantor-missing');
    expect(found[0].severity).toBe(SEVERITY.WARNING);
  });

  it('warns about a party no track serves', () => {
    const world = loadConfig({
      ...sound,
      parties: [...sound.parties, { id: 'ACME', name: 'Acme', noticeAddress: 'c@d.example' }],
    });
    const found = checkParties(world).filter((entry) => entry.code === 'party-has-no-track');
    expect(found.map((entry) => entry.where)).toEqual(['ACME']);
  });

  it('says nothing about an inactive party with no track', () => {
    const world = loadConfig({
      ...sound,
      parties: [
        ...sound.parties,
        { id: 'GONE', name: 'Closed', noticeAddress: 'x@y.example', active: false },
      ],
    });
    expect(checkParties(world).some((entry) => entry.where === 'GONE')).toBe(false);
  });
});

describe('checkAgreements', () => {
  it('catches an agreement for a party that left', () => {
    const world = loadConfig({
      ...sound,
      parties: [{ id: 'ACME', name: 'Acme', noticeAddress: 'c@d.example' }],
      agreements: [{ id: 'AVG-1', consigneeId: 'DELTA', from: '2024-01-01', to: '2024-12-31' }],
    });
    const found = checkAgreements(world);
    expect(found.some((entry) => entry.code === 'agreement-party-missing')).toBe(true);
  });

  it('warns when no page filed for that consignee allows one', () => {
    const world = loadConfig({
      ...sound,
      tariffs: [{ page: page('CON-DELTA'), effectiveFrom: '2024-01-01', consigneeId: 'DELTA' }],
    });
    const found = checkAgreements(world).filter((entry) => entry.code === 'agreement-not-allowed');
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(SEVERITY.WARNING);
  });

  it('says nothing when a general page is the only one on file', () => {
    const world = loadConfig({
      ...sound,
      tariffs: [{ page: page('DEM-4000'), effectiveFrom: '2024-01-01' }],
    });
    expect(checkAgreements(world).some((entry) => entry.code === 'agreement-not-allowed')).toBe(
      false
    );
  });
});

describe('checkTariffs', () => {
  it('catches a carrier with no page at all', () => {
    const world = loadConfig({
      ...sound,
      stations: [...sound.stations, { splc: '509100', name: 'Cordova', carrier: 'UP' }],
    });
    const found = checkTariffs(world).filter((entry) => entry.code === 'carrier-has-no-tariff');
    expect(found.map((entry) => entry.where)).toEqual(['UP']);
  });

  it('catches a filing against a station nobody entered', () => {
    const world = loadConfig({
      ...sound,
      tariffs: [
        { page: page('STA-1'), effectiveFrom: '2024-01-01', splc: '999999' },
        ...sound.tariffs,
      ],
    });
    expect(checkTariffs(world).some((entry) => entry.code === 'tariff-station-missing')).toBe(true);
  });

  it('catches a filing against a consignee nobody entered', () => {
    const world = loadConfig({
      ...sound,
      tariffs: [
        { page: page('CON-X'), effectiveFrom: '2024-01-01', consigneeId: 'NOBODY' },
        ...sound.tariffs,
      ],
    });
    expect(checkTariffs(world).some((entry) => entry.code === 'tariff-consignee-missing')).toBe(
      true
    );
  });
});

describe('validateWorld', () => {
  const world = loadConfig({
    ...sound,
    tracks: [{ ...sound.tracks[0], consigneeId: 'NOBODY' }],
    parties: [{ ...sound.parties[0], responsibleFor: ['ALSO-NOBODY'] }],
  });
  const problems = validateWorld(world);

  it('puts the errors before the warnings', () => {
    expect(problems[0].severity).toBe(SEVERITY.ERROR);
    expect(problems[problems.length - 1].severity).toBe(SEVERITY.WARNING);
  });

  it('says the configuration cannot be used', () => {
    expect(isUsable(problems)).toBe(false);
    expect(errorsOnly(problems).length).toBeGreaterThan(0);
  });

  it('flattens to rows for the table', () => {
    const rows = validationRows(problems);
    expect(Object.keys(rows[0]).sort()).toEqual(['code', 'detail', 'severity', 'where']);
  });
});
