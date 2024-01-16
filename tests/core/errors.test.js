import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  IngestError,
  NotFoundError,
  RuleError,
  SpurtallyError,
  ValidationError,
  codeOf,
  isSpurtallyError,
} from '../../src/core/errors.js';

describe('SpurtallyError', () => {
  it('keeps the constructor name', () => {
    const err = new ValidationError('bad reporting mark');
    expect(err.name).toBe('ValidationError');
  });

  it('is an ordinary Error', () => {
    expect(new SpurtallyError('x', 'X')).toBeInstanceOf(Error);
  });

  it('serialises to a flat object', () => {
    const err = new SpurtallyError('boom', 'X', { car: 'BNSF 400123' });
    expect(err.toJSON()).toEqual({
      name: 'SpurtallyError',
      code: 'X',
      message: 'boom',
      details: { car: 'BNSF 400123' },
    });
  });
});

describe('the subclasses', () => {
  it('stamps VALIDATION', () => {
    expect(new ValidationError('nope').code).toBe('VALIDATION');
  });

  it('builds a NotFoundError message from its parts', () => {
    const err = new NotFoundError('tariff', 'DEM-4000');
    expect(err.message).toBe('no tariff found for DEM-4000');
    expect(err.what).toBe('tariff');
    expect(err.key).toBe('DEM-4000');
    expect(err.code).toBe('NOT_FOUND');
  });

  it('merges extra details into a NotFoundError', () => {
    const err = new NotFoundError('car', 'UP 12', { station: 'MEMPHIS' });
    expect(err.details).toEqual({ what: 'car', key: 'UP 12', station: 'MEMPHIS' });
  });

  it('stamps CONFLICT', () => {
    expect(new ConflictError('two placements').code).toBe('CONFLICT');
  });

  it('carries the rule that fired', () => {
    const err = new RuleError('clock already stopped', 'clock.stop-once');
    expect(err.rule).toBe('clock.stop-once');
    expect(err.details.rule).toBe('clock.stop-once');
  });

  it('stamps INGEST', () => {
    expect(new IngestError('row 4 is short').code).toBe('INGEST');
  });
});

describe('helpers', () => {
  it('recognises our own errors', () => {
    expect(isSpurtallyError(new RuleError('x', 'y'))).toBe(true);
    expect(isSpurtallyError(new Error('x'))).toBe(false);
    expect(isSpurtallyError(null)).toBe(false);
  });

  it('falls back to UNKNOWN', () => {
    expect(codeOf(new Error('x'))).toBe('UNKNOWN');
    expect(codeOf(new ValidationError('x'))).toBe('VALIDATION');
  });
});
