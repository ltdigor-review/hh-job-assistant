#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const EXTENSION_ID = process.env.HHJA_EXTENSION_ID || 'ohcopjcjekbfmlplembcbjocilnginmj';
const PROFILE = process.env.HHJA_CHROME_PROFILE || 'Profile 1';
const DEFAULT_STORAGE_DIR = join(
  homedir(),
  'Library/Application Support/Google/Chrome',
  PROFILE,
  'Local Extension Settings',
  EXTENSION_ID
);

function parseArgs(argv) {
  const args = {
    storageDir: process.env.HHJA_EXTENSION_STORAGE_DIR || DEFAULT_STORAGE_DIR,
    since: process.env.HHJA_SINCE || '',
    json: false,
    output: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--json') {
      args.json = true;
    } else if (value === '--since') {
      args.since = argv[++index] || '';
    } else if (value === '--storage-dir') {
      args.storageDir = argv[++index] || args.storageDir;
    } else if (value === '--output') {
      args.output = argv[++index] || '';
    }
  }
  return args;
}

function extractJsonObjects(text, key) {
  const objects = [];
  let position = 0;
  while (position < text.length) {
    const keyIndex = text.indexOf(key, position);
    if (keyIndex === -1) break;
    const start = text.lastIndexOf('{', keyIndex);
    if (start === -1) {
      position = keyIndex + key.length;
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            objects.push(JSON.parse(text.slice(start, index + 1)));
          } catch {
            // LevelDB strings can include stale or partial values.
          }
          position = index + 1;
          break;
        }
      }
    }
    if (position <= keyIndex) position = keyIndex + key.length;
  }
  return objects;
}

function dedupeResults(items, since) {
  const byKey = new Map();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (since && String(item.timestamp || '') < since) continue;
    const key = item.vacancyId || item.url || `${item.title}:${item.timestamp}:${item.status}`;
    byKey.set(key, item);
  }
  return [...byKey.values()].sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
}

function extractField(fragment, field) {
  const match = fragment.match(new RegExp(`"${field}":(?:"([^"]*)"|(true|false|null|-?\\d+(?:\\.\\d+)?))`));
  if (!match) return '';
  if (match[1] !== undefined) return match[1];
  if (match[2] === 'true') return true;
  if (match[2] === 'false') return false;
  if (match[2] === 'null') return null;
  return Number(match[2]);
}

function extractRunResultFragments(text) {
  const results = [];
  let position = 0;
  while (position < text.length) {
    const eventIndex = text.indexOf('"event":"run_result"', position);
    if (eventIndex === -1) break;
    const detailsStart = text.lastIndexOf('"details":{', eventIndex);
    const detailsEnd = text.indexOf('},"event":"run_result"', detailsStart);
    position = eventIndex + 1;
    if (detailsStart === -1 || detailsEnd === -1 || detailsEnd > eventIndex) continue;
    const details = text.slice(detailsStart + '"details":{'.length, detailsEnd);
    const status = extractField(details, 'status');
    const timestamp = extractField(details, 'timestamp');
    if (!status || !timestamp) continue;
    results.push({
      coverLetterUsed: Boolean(extractField(details, 'coverLetterUsed')),
      error: extractField(details, 'error') || '',
      index: extractField(details, 'index') || 0,
      status,
      testDetected: Boolean(extractField(details, 'testDetected')),
      timestamp,
      title: extractField(details, 'title') || '',
      url: extractField(details, 'url') || '',
      vacancyId: extractField(details, 'vacancyId') || ''
    });
  }
  return results;
}

function extractLatestRunState(text) {
  const states = [];
  const stateFragments = [
    ...text.matchAll(/runState\s*[\r\n]+(\{[\s\S]{0,1200}?\})/g),
    ...text.matchAll(/"details":\{([\s\S]{0,1200}?)\},"event":"run_state"/g)
  ];

  for (const match of stateFragments) {
    const fragment = match[1];
    const updatedAt = extractField(fragment, 'updatedAt') || extractField(match[0], 'timestamp');
    const state = extractField(fragment, 'state');
    if (!state || !updatedAt) continue;
    states.push({
      applied: Number(extractField(fragment, 'applied') || 0),
      errors: Number(extractField(fragment, 'errors') || 0),
      found: Number(extractField(fragment, 'found') || 0),
      lastError: extractField(fragment, 'lastError') || '',
      processed: Number(extractField(fragment, 'processed') || 0),
      skipped: Number(extractField(fragment, 'skipped') || 0),
      state,
      updatedAt
    });
  }

  return states.sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''))).at(-1) || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.storageDir)) {
    throw new Error(`Extension storage dir not found: ${args.storageDir}`);
  }

  const files = readdirSync(args.storageDir).map((name) => join(args.storageDir, name));
  const { stdout } = await execFileAsync('strings', files, { maxBuffer: 64 * 1024 * 1024 });
  const logArrays = extractJsonObjects(stdout, '"event":"run_result"').filter((item) => Array.isArray(item));
  const logEntries = logArrays.flat();
  const runResults = extractJsonObjects(stdout, '"status":"applied').filter((item) => item.status);
  const fragmentResults = extractRunResultFragments(stdout);
  const latestState = extractLatestRunState(stdout);

  const results = dedupeResults(
    [
      ...logEntries.filter((item) => item.event === 'run_result').map((item) => item.details),
      ...runResults,
      ...fragmentResults
    ],
    args.since
  );
  const applied = results.filter((item) => /^applied/.test(item.status || ''));
  const skipped = results.filter((item) => /^skipped/.test(item.status || ''));

  const report = {
    generatedAt: new Date().toISOString(),
    storageDir: args.storageDir,
    since: args.since,
    counts: {
      applied: applied.length,
      skipped: skipped.length,
      results: results.length
    },
    latestState,
    applied
  };

  if (args.output) {
    writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Applied: ${applied.length}`);
  console.log(`Skipped: ${skipped.length}`);
  if (latestState) {
    console.log(`Latest state: ${latestState.state}, applied=${latestState.applied}, processed=${latestState.processed}, updatedAt=${latestState.updatedAt}`);
  }
  for (const item of applied.slice(-10)) {
    console.log(`${item.timestamp || ''} ${item.status || ''} ${item.vacancyId || ''} ${item.title || ''}`.trim());
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
