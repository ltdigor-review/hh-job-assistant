#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';

const testFiles = (await readdir(new URL('../tests/', import.meta.url)))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => `tests/${name}`);

const child = spawn(process.execPath, ['--test', ...testFiles], {
  cwd: new URL('../', import.meta.url),
  env: process.env,
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

if (exitCode === 0 && (failed > 0 || cancelled > 0)) {
  console.error(`Test validation failed: ${failed} failed, ${cancelled} cancelled.`);
  process.exitCode = 1;
} else {
  process.exitCode = exitCode;
}
