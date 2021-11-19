#!/usr/bin/env node

import { fatal } from './lib/log.js';
import { run } from './cli.js';

if (!('NODE_ENV' in process.env)) {
  process.env.NODE_ENV = 'production';
}

run(process.argv.splice(2), process.stdout, process.stderr, process.stdin)
  .then(() => process.nextTick(() => process.exit(0)))
  .catch(err => {
    console.error(`unexpected error ${process.argv.join(' ')}`, err);
    fatal(`unexpected error ${process.argv.join(' ')}`, err);
    process.nextTick(() => process.exit(1));
  });
