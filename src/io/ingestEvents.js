import { IngestError, isSpurtallyError } from '../core/errors.js';
import { requireArray, requireObject, requireString } from '../core/guards.js';
import { EVENT_SOURCE, trackEvent } from '../events/event.js';
import { normalizeStream } from '../events/normalize.js';
import { parseCsvRecords } from './csv.js';
import { DEFAULT_OFFSET_MINUTES } from '../time/instant.js';

/**
 * Reading a carrier event feed. Every carrier names its columns differently and
 * two of them change the names between files, so the mapping is data rather
 * than code. A row that cannot be read is set aside with its line number; the
 * rest of the file still loads, because holding a whole month because one row
 * is short is how a billing period gets missed.
 */

export const DEFAULT_COLUMN_MAP = Object.freeze({
  carId: ['car', 'car_id', 'equipment', 'equipment_id'],
  code: ['code', 'event', 'event_code', 'status'],
  at: ['at', 'event_time', 'datetime', 'timestamp'],
  trackId: ['track', 'track_id', 'spot_track'],
  spot: ['spot', 'position'],
  reportedAt: ['reported_at', 'received', 'received_at'],
  reason: ['reason', 'remark', 'note'],
});

function pick(record, names) {
  for (const name of names) {
    const value = record[name];
    if (value !== undefined && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return undefined;
}

export function mapRow(
  record,
  {
    columnMap = DEFAULT_COLUMN_MAP,
    offsetMinutes = DEFAULT_OFFSET_MINUTES,
    source = EVENT_SOURCE.CARRIER,
  } = {}
) {
  requireObject(record, 'record');
  const mapped = {};
  for (const [field, names] of Object.entries(columnMap)) {
    const value = pick(record, names);
    if (value !== undefined) {
      mapped[field] = value;
    }
  }
  if (mapped.carId === undefined) {
    throw new IngestError('row does not name a car', { record });
  }
  if (mapped.code === undefined) {
    throw new IngestError('row does not carry an event code', { car: mapped.carId });
  }
  if (mapped.at === undefined) {
    throw new IngestError('row does not carry a timestamp', { car: mapped.carId });
  }
  return trackEvent({ ...mapped, offsetMinutes, source });
}

export function ingestRecords(records, options = {}) {
  const events = [];
  const rejects = [];
  requireArray(records, 'records').forEach((record, index) => {
    try {
      events.push(mapRow(record, options));
    } catch (error) {
      if (!isSpurtallyError(error)) {
        throw error;
      }
      rejects.push({ line: index + 2, code: error.code, message: error.message, record });
    }
  });
  return { events, rejects };
}

export function ingestCsv(text, options = {}) {
  const records = parseCsvRecords(requireString(text, 'text', { allowEmpty: true }));
  const { events, rejects } = ingestRecords(records, options);
  const normalized = normalizeStream(events);
  return {
    events: normalized.events,
    problems: normalized.problems,
    rejects,
    read: records.length,
  };
}

export function ingestSummary(result) {
  return {
    read: result.read,
    accepted: result.events.length,
    rejected: result.rejects.length,
    problems: result.problems.length,
  };
}
