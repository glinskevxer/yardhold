import { describe, expect, it } from 'vitest';
import { checkExtension, emit, suggestExtension, writeOutput } from '../../src/io/output.js';
import { OUTPUT } from '../../src/cli/format.js';
import { IngestError, ValidationError } from '../../src/core/errors.js';

function rig() {
  const written = [];
  const made = [];
  const printed = [];
  return {
    written,
    made,
    printed,
    deps: {
      writeFile: (path, text) => written.push({ path, text }),
      mkdir: (path) => made.push(path),
      write: (text) => printed.push(text),
    },
  };
}

describe('checkExtension', () => {
  it('accepts the matching extension', () => {
    expect(checkExtension('out/march.csv', OUTPUT.CSV)).toBe('.csv');
    expect(checkExtension('out/march.json', OUTPUT.JSON)).toBe('.json');
    expect(checkExtension('out/march.txt', OUTPUT.TABLE)).toBe('.txt');
  });

  it('lets a table go to a file with no extension', () => {
    expect(checkExtension('out/march', OUTPUT.TABLE)).toBe('');
  });

  it('refuses a table written to a csv name', () => {
    try {
      checkExtension('out/march.csv', OUTPUT.TABLE);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.details.expected).toEqual(['.txt', '.text']);
    }
  });

  it('refuses json written to a txt name', () => {
    expect(() => checkExtension('out/march.txt', OUTPUT.JSON)).toThrow(/does not match/);
  });

  it('reports a missing extension as null rather than empty', () => {
    try {
      checkExtension('out/march', OUTPUT.CSV);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.details.extension).toBeNull();
    }
  });

  it('refuses a format it has no rule for', () => {
    expect(() => checkExtension('out/march.csv', 'xml')).toThrow(/no extension rule/);
  });

  it('needs a path', () => {
    expect(() => checkExtension(undefined, OUTPUT.CSV)).toThrow(ValidationError);
  });
});

describe('writeOutput', () => {
  it('makes the directory and writes the file', () => {
    const harness = rig();
    const result = writeOutput('out/reports/march.csv', 'a,b\n1,2\n', OUTPUT.CSV, harness.deps);
    expect(harness.made).toHaveLength(1);
    expect(harness.written[0].path).toBe(result.path);
    expect(result.bytes).toBe(8);
  });

  it('adds a trailing newline when there is not one', () => {
    const harness = rig();
    writeOutput('out/march.csv', 'a,b', OUTPUT.CSV, harness.deps);
    expect(harness.written[0].text).toBe('a,b\n');
  });

  it('does not add a second newline', () => {
    const harness = rig();
    writeOutput('out/march.csv', 'a,b\n', OUTPUT.CSV, harness.deps);
    expect(harness.written[0].text).toBe('a,b\n');
  });

  it('wraps a write failure', () => {
    const harness = rig();
    harness.deps.writeFile = () => {
      throw new Error('EACCES');
    };
    expect(() => writeOutput('out/march.csv', 'a', OUTPUT.CSV, harness.deps)).toThrow(IngestError);
  });

  it('checks the extension before it touches the disk', () => {
    const harness = rig();
    expect(() => writeOutput('out/march.csv', 'a', OUTPUT.JSON, harness.deps)).toThrow(
      ValidationError
    );
    expect(harness.written).toEqual([]);
  });
});

describe('emit', () => {
  it('prints when no file was named', () => {
    const harness = rig();
    const result = emit('hello', {}, harness.deps);
    expect(result.written).toBe(false);
    expect(harness.printed).toEqual(['hello']);
    expect(harness.written).toEqual([]);
  });

  it('writes and says where when a file was named', () => {
    const harness = rig();
    const result = emit('a,b', { out: 'out/march.csv', output: OUTPUT.CSV }, harness.deps);
    expect(result.written).toBe(true);
    expect(harness.printed[0]).toMatch(/^wrote .*out\/march\.csv$/);
  });

  it('defaults the format to a table', () => {
    const harness = rig();
    expect(() => emit('hello', { out: 'out/march.csv' }, harness.deps)).toThrow(ValidationError);
  });
});

describe('suggestExtension', () => {
  it('names the first real extension for a format', () => {
    expect(suggestExtension(OUTPUT.CSV)).toBe('.csv');
    expect(suggestExtension(OUTPUT.TABLE)).toBe('.txt');
    expect(suggestExtension('xml')).toBeUndefined();
  });
});
