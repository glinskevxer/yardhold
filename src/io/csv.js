import { IngestError } from '../core/errors.js';
import { requireArray, requireString } from '../core/guards.js';

/**
 * A CSV reader that is strict about the things the carrier feeds actually get
 * wrong: ragged rows, a header repeated in the middle of the file, and quoted
 * fields with an embedded newline. Anything it cannot read it names by line.
 */

export function parseCsv(text, { delimiter = ',', trim = true } = {}) {
  requireString(text, 'text', { allowEmpty: true });
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  let index = 0;
  let touched = false;
  while (index < text.length) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }
    if (character === '"') {
      if (field !== '' && trim === false) {
        throw new IngestError('a quote cannot open in the middle of a field', { row: rows.length });
      }
      quoted = true;
      touched = true;
      index += 1;
      continue;
    }
    if (character === delimiter) {
      row.push(trim ? field.trim() : field);
      field = '';
      touched = true;
      index += 1;
      continue;
    }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      if (touched || field !== '') {
        row.push(trim ? field.trim() : field);
        rows.push(row);
      }
      field = '';
      row = [];
      touched = false;
      index += 1;
      continue;
    }
    field += character;
    touched = true;
    index += 1;
  }
  if (quoted) {
    throw new IngestError('the file ends inside a quoted field', { row: rows.length + 1 });
  }
  if (touched || field !== '') {
    row.push(trim ? field.trim() : field);
    rows.push(row);
  }
  return rows;
}

export function parseCsvRecords(text, options = {}) {
  const rows = parseCsv(text, options);
  if (rows.length === 0) {
    return [];
  }
  const header = rows[0].map((name) => name.trim());
  const records = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.length === 1 && row[0] === '') {
      continue;
    }
    if (row.length !== header.length) {
      throw new IngestError('row has a different number of fields than the header', {
        line: index + 1,
        expected: header.length,
        found: row.length,
      });
    }
    const record = {};
    for (let column = 0; column < header.length; column += 1) {
      record[header[column]] = row[column];
    }
    records.push(record);
  }
  return records;
}

function quoteField(value, delimiter) {
  const text = value === undefined || value === null ? '' : String(value);
  if (text.includes('"') || text.includes(delimiter) || /[\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(records, { columns, delimiter = ',' } = {}) {
  requireArray(records, 'records');
  const header = columns ?? [...new Set(records.flatMap((record) => Object.keys(record)))].sort();
  const lines = [header.map((name) => quoteField(name, delimiter)).join(delimiter)];
  for (const record of records) {
    lines.push(header.map((name) => quoteField(record[name], delimiter)).join(delimiter));
  }
  return `${lines.join('\n')}\n`;
}
