'use strict';

require('./cli.js').run(process.argv.splice(2), process.stdout, process.stderr, process.stdin, (err) => {
  if (err) {
    throw err;
  } else {
    process.exit(0);
  }
});
