import { ValidationError } from '../../core/errors.js';
import { sectionCounts } from '../../config/schema.js';
import { worldSummary } from '../../config/loadConfig.js';
import { errorsOnly, isUsable, validateWorld, validationRows } from '../../config/validate.js';
import { OUTPUT, keyValueBlock, renderRows } from '../format.js';
import { loadWorld, resolveOutput } from '../context.js';

/**
 * spurtally validate
 *
 * Run before a month end rather than during one. It takes no event feed, which
 * is the point: a configuration that cannot be checked without a month of data
 * gets checked by running a month and looking at what came out wrong.
 */

export function validateBody(world, problems, { output = OUTPUT.TABLE, strict = false } = {}) {
  const summary = worldSummary(world);
  if (output === OUTPUT.JSON) {
    return JSON.stringify({ summary, problems }, null, 2);
  }
  const rows = validationRows(problems);
  if (output === OUTPUT.CSV) {
    return renderRows(rows, OUTPUT.CSV, ['severity', 'code', 'where', 'detail']);
  }
  const head = keyValueBlock(summary);
  if (problems.length === 0) {
    return [head, '', 'nothing to report'].join('\n');
  }
  const shown = strict ? problems : errorsOnly(problems);
  const body =
    shown.length === 0
      ? `no errors, ${problems.length} warning(s) not shown`
      : renderRows(validationRows(shown), OUTPUT.TABLE, ['severity', 'code', 'where', 'detail']);
  return [head, '', body].join('\n');
}

export function runValidate(options, deps = {}) {
  const output = resolveOutput(options.output);
  const world = loadWorld(options.config, deps);
  const problems = validateWorld(world);
  if (options.failOnWarning === true && problems.length > 0) {
    throw new ValidationError('the configuration has warnings and strict was asked for', {
      problems: problems.length,
    });
  }
  if (!isUsable(problems)) {
    throw new ValidationError('the configuration has errors', {
      errors: errorsOnly(problems).length,
      first: errorsOnly(problems)[0],
    });
  }
  return {
    text: validateBody(world, problems, { output, strict: options.strict === true }),
    world,
    problems,
  };
}

export function documentCounts(document) {
  return sectionCounts(document);
}
