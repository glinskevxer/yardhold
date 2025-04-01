import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { IngestError, ValidationError } from '../core/errors.js';
import { requireString } from '../core/guards.js';
import { OUTPUT } from '../cli/format.js';

/**
 * Writing a report out.
 *
 * A month end run produces four files that go to four people, and doing it by
 * shell redirection loses the exit code, so it is done here instead. The
 * extension has to agree with the format: a file called invoice.csv holding a
 * text table is the kind of thing that gets emailed to a carrier and argued
 * about for a week.
 */

const EXPECTED = Object.freeze({
  [OUTPUT.TABLE]: ['.txt', '.text', ''],
  [OUTPUT.CSV]: ['.csv'],
  [OUTPUT.JSON]: ['.json'],
});

export function checkExtension(path, format) {
  const extension = extname(requireString(path, 'path')).toLowerCase();
  const allowed = EXPECTED[format];
  if (allowed === undefined) {
    throw new ValidationError('there is no extension rule for that format', { format });
  }
  if (!allowed.includes(extension)) {
    throw new ValidationError('the file extension does not match the output format', {
      path,
      format,
      extension: extension === '' ? null : extension,
      expected: allowed.filter((entry) => entry !== ''),
    });
  }
  return extension;
}

export function writeOutput(path, text, format = OUTPUT.TABLE, deps = {}) {
  checkExtension(path, format);
  const full = resolve(path);
  const write = deps.writeFile ?? writeFileSync;
  const makeDirectory = deps.mkdir ?? mkdirSync;
  try {
    makeDirectory(dirname(full), { recursive: true });
    write(full, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  } catch (error) {
    throw new IngestError('could not write the file', { path: full, detail: error.message });
  }
  return { path: full, bytes: Buffer.byteLength(text, 'utf8') };
}

export function emit(text, options = {}, deps = {}) {
  if (options.out === undefined) {
    (deps.write ?? ((value) => console.log(value)))(text);
    return { written: false };
  }
  const result = writeOutput(options.out, text, options.output ?? OUTPUT.TABLE, deps);
  (deps.write ?? ((value) => console.log(value)))(`wrote ${result.path}`);
  return { written: true, ...result };
}

export function suggestExtension(format) {
  const allowed = EXPECTED[format];
  return allowed === undefined ? undefined : allowed.find((entry) => entry !== '');
}
