import { requireArray } from '../core/guards.js';
import { EVENT_SOURCE, compareEvents, isCancelled } from './event.js';
import { eventKind, resumeCodeFor } from './eventTypes.js';
import { groupByCar } from './ledger.js';

/**
 * Feeds repeat themselves, arrive out of order and occasionally contradict
 * themselves. Normalising a stream never throws: a car with a broken sequence
 * still has to be billed, so the problems come back beside the events and the
 * clock decides for itself which ones it can live with.
 */

export const PROBLEM = Object.freeze({
  DUPLICATE: 'duplicate',
  STOP_BEFORE_START: 'stop-before-start',
  DOUBLE_START: 'double-start',
  DOUBLE_STOP: 'double-stop',
  UNPAIRED_SUSPENSION: 'unpaired-suspension',
  RESUME_WITHOUT_SUSPENSION: 'resume-without-suspension',
  SUPERSEDED_MISSING: 'superseded-missing',
});

const SOURCE_RANK = {
  [EVENT_SOURCE.CARRIER]: 3,
  [EVENT_SOURCE.OFFICE]: 2,
  [EVENT_SOURCE.DERIVED]: 1,
};

function preferred(left, right) {
  const bySource = (SOURCE_RANK[right.source] ?? 0) - (SOURCE_RANK[left.source] ?? 0);
  if (bySource !== 0) {
    return bySource < 0 ? left : right;
  }
  return left.reportedAt <= right.reportedAt ? left : right;
}

export function dedupe(events) {
  const kept = new Map();
  const problems = [];
  for (const record of requireArray(events, 'events')) {
    const existing = kept.get(record.id);
    if (!existing) {
      kept.set(record.id, record);
      continue;
    }
    problems.push({
      kind: PROBLEM.DUPLICATE,
      carId: record.carId,
      code: record.code,
      at: record.at,
      eventId: record.id,
    });
    kept.set(record.id, preferred(existing, record));
  }
  return { events: [...kept.values()].sort(compareEvents), problems };
}

export function applySupersessions(events) {
  const byId = new Map(events.map((record) => [record.id, record]));
  const cancelled = new Set();
  const problems = [];
  for (const record of events) {
    if (record.supersedes === undefined) {
      continue;
    }
    if (!byId.has(record.supersedes)) {
      problems.push({
        kind: PROBLEM.SUPERSEDED_MISSING,
        carId: record.carId,
        code: record.code,
        at: record.at,
        eventId: record.supersedes,
      });
      continue;
    }
    cancelled.add(record.supersedes);
  }
  const applied = events.map((record) =>
    cancelled.has(record.id)
      ? Object.freeze({ ...record, cancelled: true, reason: 'superseded' })
      : record
  );
  return { events: applied, problems };
}

const PROGRESSIONS = Object.freeze({ CP: ['AP', 'RSP'] });

/** Constructive placement followed by actual placement is one arrival. */
export function isProgression(from, to) {
  return (PROGRESSIONS[from] ?? []).includes(to);
}

export function checkSequence(events) {
  const problems = [];
  for (const [carId, stream] of groupByCar(events.filter((record) => !isCancelled(record)))) {
    let startedWith;
    let suspended = false;
    for (const record of stream) {
      const kind = eventKind(record.code);
      if (kind.starts) {
        /**
         * A car held on the carrier's track and then spotted reports CP and
         * then AP with no release between, and that is the ordinary way round
         * rather than a double placement. Flagging it filled the exception
         * report with every constructively placed car on the property.
         */
        if (startedWith !== undefined && !isProgression(startedWith, record.code)) {
          problems.push({ kind: PROBLEM.DOUBLE_START, carId, code: record.code, at: record.at });
        }
        startedWith = record.code;
        continue;
      }
      if (kind.stops) {
        if (startedWith === undefined) {
          problems.push({
            kind: PROBLEM.STOP_BEFORE_START,
            carId,
            code: record.code,
            at: record.at,
          });
        } else {
          startedWith = undefined;
        }
        continue;
      }
      if (kind.suspends) {
        suspended = true;
        continue;
      }
      if (kind.resumes && !suspended) {
        problems.push({
          kind: PROBLEM.RESUME_WITHOUT_SUSPENSION,
          carId,
          code: record.code,
          at: record.at,
        });
      }
      if (kind.resumes) {
        suspended = false;
      }
    }
    if (suspended) {
      const last = stream[stream.length - 1];
      problems.push({
        kind: PROBLEM.UNPAIRED_SUSPENSION,
        carId,
        code: last.code,
        at: last.at,
        expected: resumeCodeFor(last.code),
      });
    }
  }
  return problems;
}

export function normalizeStream(events) {
  const deduped = dedupe(events);
  const superseded = applySupersessions(deduped.events);
  const problems = [
    ...deduped.problems,
    ...superseded.problems,
    ...checkSequence(superseded.events),
  ];
  return { events: superseded.events, problems };
}

export function problemsOfKind(problems, kind) {
  return problems.filter((problem) => problem.kind === kind);
}
