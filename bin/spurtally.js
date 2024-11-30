#!/usr/bin/env node
import { main } from '../src/cli/program.js';

const code = await main(process.argv.slice(2));
process.exitCode = code;
