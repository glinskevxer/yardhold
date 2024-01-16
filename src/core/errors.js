/**
 * Error hierarchy for the tally engine.
 *
 * Every failure carries a stable `code` so the CLI and the ingest pipeline can
 * branch on it without matching message text. Messages are for humans, codes
 * are for the machine.
 */

export class SpurtallyError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, details: this.details };
  }
}

/** The caller handed us something the domain cannot accept at all. */
export class ValidationError extends SpurtallyError {
  constructor(message, details = {}) {
    super(message, 'VALIDATION', details);
  }
}

/** A record referenced something that is not in the book. */
export class NotFoundError extends SpurtallyError {
  constructor(what, key, details = {}) {
    super(`no ${what} found for ${String(key)}`, 'NOT_FOUND', { what, key, ...details });
    this.what = what;
    this.key = key;
  }
}

/** Two records disagree and neither one is obviously wrong. */
export class ConflictError extends SpurtallyError {
  constructor(message, details = {}) {
    super(message, 'CONFLICT', details);
  }
}

/** The engine was asked to do something the rules forbid in this state. */
export class RuleError extends SpurtallyError {
  constructor(message, rule, details = {}) {
    super(message, 'RULE', { rule, ...details });
    this.rule = rule;
  }
}

/** Reading an outside feed blew up. */
export class IngestError extends SpurtallyError {
  constructor(message, details = {}) {
    super(message, 'INGEST', details);
  }
}

export function isSpurtallyError(value) {
  return value instanceof SpurtallyError;
}

export function codeOf(value) {
  return isSpurtallyError(value) ? value.code : 'UNKNOWN';
}
