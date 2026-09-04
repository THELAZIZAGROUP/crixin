#!/usr/bin/env node
// npx entrypoint. Imports the compiled CLI.
import('../dist/cli/index.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
