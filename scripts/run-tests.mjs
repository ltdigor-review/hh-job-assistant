#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadBusinessSpecContract,
  validateRuntimeCoverage
} from './business-spec-contract.mjs';

const testFiles = (await readdir(new URL('../tests/', import.meta.url)))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => `tests/${name}`);

let businessSpec;
try {
  businessSpec = await loadBusinessSpecContract();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const resultDirectory = await mkdtemp(join(tmpdir(), 'hhja-test-events-'));
const eventFile = join(resultDirectory, 'passed-tests.jsonl');
const reporterPath = fileURLToPath(new URL('./business-spec-reporter.mjs', import.meta.url));
const child = spawn(process.execPath, ['--test', `--test-reporter=${reporterPath}`, ...testFiles], {
  cwd: new URL('../', import.meta.url),
  env: {
    ...process.env,
    HHJA_TEST_EVENT_FILE: eventFile
  },
  stdio: ['inherit', 'pipe', 'pipe']
});

let output = '';
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    const text = chunk.toString();
    output += text;
    const target = stream === child.stdout ? process.stdout : process.stderr;
    target.write(chunk);
  });
}

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', (code, signal) => {
    if (signal) {
      reject(new Error(`Test process terminated by ${signal}`));
      return;
    }
    resolve(code ?? 1);
  });
});

function summaryCount(label) {
  const pattern = new RegExp(`(?:^|\\n)(?:#\\s*|ℹ\\s*)${label}\\s+(\\d+)\\b`, 'gim');
  return [...output.matchAll(pattern)]
    .reduce((maximum, match) => Math.max(maximum, Number(match[1]) || 0), 0);
}

const failed = summaryCount('fail');
const cancelled = summaryCount('cancelled');
let businessSpecFailed = false;

try {
  const eventText = await readFile(eventFile, 'utf8');
  const testEvents = eventText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid structured test event on line ${index + 1}: ${error.message}`);
      }
    });
  validateRuntimeCoverage(testEvents, businessSpec.coverage);
} catch (error) {
  businessSpecFailed = true;
  console.error(error.message);
} finally {
  await rm(resultDirectory, { recursive: true, force: true });
}

if (exitCode === 0 && (failed > 0 || cancelled > 0)) {
  console.error(`Test validation failed: ${failed} failed, ${cancelled} cancelled.`);
  process.exitCode = 1;
} else if (businessSpecFailed) {
  process.exitCode = 1;
} else {
  process.exitCode = exitCode;
}
