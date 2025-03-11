import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IngestError, ValidationError, isSpurtallyError } from '../core/errors.js';
import { requireString } from '../core/guards.js';
import { loadConfig } from '../config/loadConfig.js';
import { parseDocument } from '../config/schema.js';
import { ingestCsv } from '../io/ingestEvents.js';
import { assessMonth } from '../assessment/runMonth.js';
import { OUTPUT } from './format.js';

/**
 * Everything a command needs before it can do anything: the configuration, the
 * event feed and the shared options. Reading is kept here so the commands stay
 * pure functions of their inputs and can be tested without a filesystem.
 */

export function readTextFile(path, { readFile = readFileSync } = {}) {
  const full = resolve(requireString(path, 'path'));
  try {
    return readFile(full, 'utf8');
  } catch (error) {
    throw new IngestError('could not read the file', { path: full, detail: error.message });
  }
}

export function loadWorld(path, options = {}) {
  return loadConfig(parseDocument(readTextFile(path, options)));
}

export function resolveOutput(value) {
  if (value === undefined) {
    return OUTPUT.TABLE;
  }
  const wanted = String(value).toLowerCase();
  if (!Object.values(OUTPUT).includes(wanted)) {
    throw new ValidationError('output has to be table, csv or json', { value });
  }
  return wanted;
}

export function resolvePeriod(value) {
  const period = requireString(value, 'period').trim();
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(period)) {
    throw new ValidationError('a period is written YYYYMM', { value });
  }
  return period;
}

export function commandContext(options = {}, deps = {}) {
  return {
    world: loadWorld(options.config, deps),
    output: resolveOutput(options.output),
    asOf: options.asOf,
    period: options.period === undefined ? undefined : resolvePeriod(options.period),
  };
}

/**
 * Every command does the same three things before it does its own: build the
 * world, read the feed and assess the month. Four copies of that had already
 * drifted apart on which offset the feed was read at.
 */
export function loadRun(options, deps = {}) {
  const context = commandContext(options, deps);
  const feed = ingestCsv(readTextFile(options.events, deps), {
    offsetMinutes: context.world.settings.offsetMinutes,
  });
  const result = assessMonth(context.world, feed.events, {
    period: context.period,
    carrier: options.carrier,
  });
  return { context, feed, result };
}

/** Turn a thrown domain error into a message and an exit code, never a stack. */
export function reportError(error) {
  if (isSpurtallyError(error)) {
    return { message: `${error.code.toLowerCase()}: ${error.message}`, code: 2 };
  }
  return { message: `unexpected: ${error.message}`, code: 70 };
}
