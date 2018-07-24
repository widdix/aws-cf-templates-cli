#!/usr/bin/env node

'use strict';

const loglib = require('./lib/log.js');

require('./cli.js').run(process.argv.splice(2), process.stdout, process.stderr, process.stdin)
  .then(() => process.nextTick(() => process.exit(0)))
  .catch(err => {
    console.error(`unexpected error ${process.argv.join(' ')}`, err);
    loglib.fatal(`unexpected error ${process.argv.join(' ')}`, err);
    process.nextTick(() => process.exit(1));
  });
