import { Command } from 'commander';
import { runAssess } from './commands/assess.js';
import { runInvoice } from './commands/invoice.js';
import { runExplain } from './commands/explain.js';
import { runReport } from './commands/report.js';
import { reportError, resolveOutput } from './context.js';
import { emit } from '../io/output.js';

export const VERSION = '0.7.0';

/**
 * The command line.
 *
 * Nothing here does any work. Each subcommand gathers its options, hands them
 * to a run function that knows nothing about the terminal, and prints what
 * comes back. Keeping the boundary that hard is what lets every command be
 * tested without a shell.
 */

function shared(command) {
  return command
    .requiredOption('-c, --config <path>', 'configuration document')
    .requiredOption('-e, --events <path>', 'car event feed as CSV')
    .requiredOption('-p, --period <yyyymm>', 'billing period')
    .requiredOption('-r, --carrier <mark>', 'serving carrier')
    .option('-o, --output <format>', 'table, csv or json', 'table')
    .option('--out <path>', 'write to a file rather than to the terminal');
}

export function buildProgram(deps = {}) {
  const write = deps.write ?? ((text) => console.log(text));
  const fail = deps.fail ?? ((text) => console.error(text));
  const exit = deps.exit ?? (() => {});

  function guard(run) {
    return (options) => {
      try {
        emit(
          run(options, deps).text,
          { ...options, output: resolveOutput(options.output) },
          {
            ...deps,
            write,
          }
        );
      } catch (error) {
        const reported = reportError(error);
        fail(reported.message);
        exit(reported.code);
      }
    };
  }

  const program = new Command();
  program
    .name('spurtally')
    .description('demurrage, storage and car hire accounting for a private industry track')
    .version(VERSION)
    .exitOverride();

  shared(program.command('assess').description('assess every car for a period'))
    .option('-d, --detail', 'one row per chargeable day')
    .action(guard(runAssess));

  shared(program.command('invoice').description('cut an invoice per consignee'))
    .requiredOption('-i, --issued-on <date>', 'invoice date')
    .action(guard(runInvoice));

  shared(program.command('explain').description('explain how one car was counted'))
    .requiredOption('-k, --car <id>', 'car initial and number')
    .action(guard(runExplain));

  shared(program.command('report').description('exceptions, month figures or dwell'))
    .option('-t, --report <kind>', 'exceptions, kpi, dwell or register', 'exceptions')
    .action(guard(runReport));

  program.addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  spurtally assess  -c world.json -e march.csv -p 202403 -r BNSF',
      '  spurtally assess  -c world.json -e march.csv -p 202403 -r BNSF --detail',
      '  spurtally invoice -c world.json -e march.csv -p 202403 -r BNSF -i 2024-04-05',
      '  spurtally explain -c world.json -e march.csv -p 202403 -r BNSF -k "BNSF 400123"',
      '  spurtally report  -c world.json -e march.csv -p 202403 -r BNSF -t kpi',
      '',
      'A period is written YYYYMM and selects the tariff page in force on the day',
      'each car was placed, not the page in force when the invoice is cut.',
    ].join('\n')
  );

  return program;
}

export function commandNames(program) {
  return program.commands.map((command) => command.name()).sort();
}

export function optionsOf(program, name) {
  const command = program.commands.find((entry) => entry.name() === name);
  return command === undefined ? [] : command.options.map((option) => option.long).sort();
}

export async function main(argv, deps = {}) {
  const program = buildProgram(deps);
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (error) {
    if (error.exitCode !== undefined) {
      return error.exitCode;
    }
    const reported = reportError(error);
    (deps.fail ?? ((text) => console.error(text)))(reported.message);
    return reported.code;
  }
}
