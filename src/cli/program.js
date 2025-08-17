import { Command } from 'commander';
import { runAssess } from './commands/assess.js';
import { runInvoice } from './commands/invoice.js';
import { runExplain } from './commands/explain.js';
import { runReport } from './commands/report.js';
import { runReconcile } from './commands/reconcile.js';
import { runValidate } from './commands/validate.js';
import { runStatement } from './commands/statement.js';
import { runFleet } from './commands/fleet.js';
import { runSettle } from './commands/settle.js';
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
    .option(
      '-t, --report <kind>',
      'exceptions, kpi, dwell, register, trips or capacity',
      'exceptions'
    )
    .action(guard(runReport));

  shared(program.command('statement').description('the detail behind an invoice'))
    .option('-n, --consignee <id>', 'one consignee rather than all of them')
    .action(guard(runStatement));

  shared(program.command('settle').description('age the open items or show an account'))
    .requiredOption('-i, --issued-on <date>', 'invoice date')
    .option('-t, --settle <kind>', 'aging or account', 'aging')
    .option('-m, --payments <path>', 'remittance advice as CSV')
    .option('-a, --as-of <date>', 'age as at this date rather than the invoice date')
    .option('-n, --consignee <id>', 'one consignee rather than all of them')
    .action(guard(runSettle));

  shared(program.command('reconcile').description('compare our count with the carrier bill'))
    .requiredOption('-b, --carrier-invoice <path>', 'the carrier demurrage invoice as CSV')
    .option('-a, --all', 'show the cars that agree as well')
    .option('--tolerance <cents>', 'cents of difference to ignore')
    .action(guard(runReconcile));

  program
    .command('fleet')
    .description('the register, the leases and the weights')
    .requiredOption('-c, --config <path>', 'configuration document')
    .requiredOption('-a, --as-of <date>', 'the day to read the leases on')
    .option('-o, --output <format>', 'table, csv or json', 'table')
    .option('--out <path>', 'write to a file rather than to the terminal')
    .option('-k, --car <id>', 'one car rather than the whole register')
    .option('-f, --flagged', 'only the cars with something wrong')
    .action(guard(runFleet));

  program
    .command('validate')
    .description('check a configuration on its own')
    .requiredOption('-c, --config <path>', 'configuration document')
    .option('-o, --output <format>', 'table, csv or json', 'table')
    .option('--out <path>', 'write to a file rather than to the terminal')
    .option('-s, --strict', 'show the warnings as well as the errors')
    .option('--fail-on-warning', 'treat a warning as a failure')
    .action(guard(runValidate));

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
      '  spurtally reconcile -c world.json -e march.csv -p 202403 -r BNSF -b carrier.csv',
      '  spurtally statement -c world.json -e march.csv -p 202403 -r BNSF -n DELTA',
      '  spurtally fleet -c world.json -a 2024-03-31 --flagged',
      '  spurtally validate -c world.json --strict',
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
