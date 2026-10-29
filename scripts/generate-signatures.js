#!/usr/bin/env node
import { runTestCommand } from '../src/cli/test-generate.js';

runTestCommand({ args: process.argv.slice(2) }).catch(error => {
  // Avoid printing directory credentials, employee attributes or driver errors.
  const code = typeof error?.code === 'string' && /^[A-Z_]+$/.test(error.code)
    ? error.code : 'TEST_GENERATION_FAILED';
  console.error('FAIL: ' + code);
  process.exitCode = 1;
});
