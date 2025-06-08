import { describe, expect, it } from 'vitest';
import {
  makeReadFile,
  sampleCarrierInvoice,
  sampleDocument,
  sampleFeed,
  sampleOptions,
  samplePage,
} from './world.js';
import { checkDocument } from '../../src/config/schema.js';
import { loadConfig } from '../../src/config/loadConfig.js';
import { validateWorld } from '../../src/config/validate.js';

describe('the shared fixture', () => {
  it('is a well formed document', () => {
    expect(() => checkDocument(sampleDocument())).not.toThrow();
  });

  it('builds a world that validates clean', () => {
    expect(validateWorld(loadConfig(sampleDocument()))).toEqual([]);
  });

  it('takes overrides', () => {
    const document = sampleDocument({ parties: [] });
    expect(document.parties).toEqual([]);
    expect(document.stations).toHaveLength(1);
  });

  it('ships a page that needs no notification', () => {
    expect(samplePage.notificationRequired).toBe(false);
  });

  it('ships a feed and a carrier invoice', () => {
    expect(sampleFeed).toContain('BNSF 400123');
    expect(sampleCarrierInvoice).toContain('600.00');
  });

  it('ships the options every command takes', () => {
    expect(sampleOptions.period).toBe('202403');
    expect(sampleOptions.carrier).toBe('BNSF');
  });
});

describe('makeReadFile', () => {
  const readFile = makeReadFile();

  it('answers for the three files', () => {
    expect(readFile('world.json')).toContain('412300');
    expect(readFile('events.csv')).toContain('AP');
    expect(readFile('carrier.csv')).toContain('amount');
  });

  it('throws for anything else', () => {
    expect(() => readFile('missing.json')).toThrow();
  });

  it('takes extra files that win over the standard ones', () => {
    const reader = makeReadFile({ extra: { 'world.json': '{}' } });
    expect(reader('world.json')).toBe('{}');
  });
});
