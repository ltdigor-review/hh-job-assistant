#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { appendFile, readFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT_URL = new URL('../', import.meta.url);
const SPEC_URL = new URL('BUSINESS_SPEC.md', ROOT_URL);
const LOCK_URL = new URL('BUSINESS_SPEC.lock.jsonl', ROOT_URL);
const TESTS_URL = new URL('tests/', ROOT_URL);
const execFileAsync = promisify(execFile);

const RULE_BEGIN = '<!-- BUSINESS_SPEC_RULE_BEGIN -->';
const RULE_END = '<!-- BUSINESS_SPEC_RULE_END -->';
const RULE_KEYS = Object.freeze([
  'schema',
  'kind',
  'id',
  'scope',
  'requirement',
  'acceptance',
  'supersedes',
  'introduced'
]);
const LOCK_KEYS = Object.freeze([
  'schema',
  'id',
  'recordSha256',
  'sourceSha256',
  'previousChainSha256',
  'chainSha256'
]);
const RULE_ID_PATTERN = /^HHJA-BR-(\d{6})$/;
const COVERAGE_PATTERN = /^\[BS:COVERS:(HHJA-BR-\d{6})\]$/;
const RETIREMENT_PATTERN = /^\[BS:RETIRES:(HHJA-BR-\d{6}):BY:(HHJA-BR-\d{6})\]$/;

function fail(message) {
  throw new Error(`Business specification contract: ${message}`);
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function assertExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(value);
  const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
  const unknown = actualKeys.filter((key) => !expectedKeys.includes(key));
  if (missing.length || unknown.length) {
    fail(
      `${label} has invalid keys` +
      `${missing.length ? `; missing: ${missing.join(', ')}` : ''}` +
      `${unknown.length ? `; unknown: ${unknown.join(', ')}` : ''}`
    );
  }
}

function topLevelJsonKeys(raw, label) {
  const keys = [];
  let objectDepth = 0;
  let arrayDepth = 0;
  let index = 0;

  while (index < raw.length) {
    const character = raw[index];
    if (character === '{') {
      objectDepth += 1;
      index += 1;
      continue;
    }
    if (character === '}') {
      objectDepth -= 1;
      index += 1;
      continue;
    }
    if (character === '[') {
      arrayDepth += 1;
      index += 1;
      continue;
    }
    if (character === ']') {
      arrayDepth -= 1;
      index += 1;
      continue;
    }
    if (character !== '"') {
      index += 1;
      continue;
    }

    const start = index;
    index += 1;
    let escaped = false;
    while (index < raw.length) {
      const current = raw[index];
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === '"') {
        break;
      }
      index += 1;
    }
    if (index >= raw.length) fail(`${label} contains an unterminated JSON string`);
    const end = index;
    index += 1;

    if (objectDepth !== 1 || arrayDepth !== 0) continue;
    let cursor = index;
    while (/\s/.test(raw[cursor] || '')) cursor += 1;
    if (raw[cursor] !== ':') continue;
    keys.push(JSON.parse(raw.slice(start, end + 1)));
  }

  const duplicate = keys.find((key, keyIndex) => keys.indexOf(key) !== keyIndex);
  if (duplicate) fail(`${label} contains duplicate JSON key "${duplicate}"`);
  return keys;
}

function parseJsonObject(raw, label) {
  topLevelJsonKeys(raw, label);
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be a JSON object`);
  }
  return value;
}

export function parseBusinessSpecMarkdown(markdown) {
  const beginCount = [...markdown.matchAll(new RegExp(RULE_BEGIN, 'g'))].length;
  const endCount = [...markdown.matchAll(new RegExp(RULE_END, 'g'))].length;
  const blockPattern = new RegExp(
    `${RULE_BEGIN}\\r?\\n\\\`\\\`\\\`json\\r?\\n([\\s\\S]*?)\\r?\\n\\\`\\\`\\\`\\r?\\n${RULE_END}`,
    'g'
  );
  const blocks = [...markdown.matchAll(blockPattern)].map((match, index) => ({
    raw: match[1],
    rule: parseJsonObject(match[1], `rule block ${index + 1}`)
  }));

  if (beginCount !== endCount || beginCount !== blocks.length) {
    fail('rule markers or JSON fences are malformed or unbalanced');
  }
  if (blocks.length === 0) fail('no normative rule blocks found');

  const rules = [];
  const activeIds = new Set();
  const seenIds = new Set();
  const supersessionEdges = [];

  for (const [index, block] of blocks.entries()) {
    const { rule } = block;
    const label = `rule block ${index + 1}`;
    assertExactKeys(rule, RULE_KEYS, label);
    if (rule.schema !== 1) fail(`${label} has unsupported schema`);
    if (rule.kind !== 'business-rule') fail(`${label} has invalid kind`);

    const idMatch = RULE_ID_PATTERN.exec(rule.id);
    if (!idMatch) fail(`${label} has invalid id`);
    const expectedNumber = index + 1;
    if (Number(idMatch[1]) !== expectedNumber) {
      fail(`${label} must use contiguous id HHJA-BR-${String(expectedNumber).padStart(6, '0')}`);
    }
    if (seenIds.has(rule.id)) fail(`duplicate rule id ${rule.id}`);
    seenIds.add(rule.id);

    if (!/^[a-z][a-z0-9-]*$/.test(rule.scope)) fail(`${rule.id} has invalid scope`);
    if (typeof rule.requirement !== 'string' || !rule.requirement.trim()) {
      fail(`${rule.id} has an empty requirement`);
    }
    if (!/\bMUST(?: NOT)?\b/.test(rule.requirement)) {
      fail(`${rule.id} requirement must use MUST or MUST NOT`);
    }
    if (
      !Array.isArray(rule.acceptance) ||
      rule.acceptance.length === 0 ||
      rule.acceptance.some((item) => typeof item !== 'string' || !item.trim())
    ) {
      fail(`${rule.id} acceptance must contain non-empty strings`);
    }
    if (!Array.isArray(rule.supersedes) || new Set(rule.supersedes).size !== rule.supersedes.length) {
      fail(`${rule.id} supersedes must be a unique array`);
    }
    if (
      typeof rule.introduced !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(rule.introduced) ||
      Number.isNaN(Date.parse(`${rule.introduced}T00:00:00Z`))
    ) {
      fail(`${rule.id} has invalid introduced date`);
    }

    for (const retiredId of rule.supersedes) {
      if (!RULE_ID_PATTERN.test(retiredId)) fail(`${rule.id} supersedes invalid id ${retiredId}`);
      if (!activeIds.has(retiredId)) {
        fail(`${rule.id} supersedes ${retiredId}, which is missing, forward, or already retired`);
      }
      activeIds.delete(retiredId);
      supersessionEdges.push({ oldId: retiredId, newId: rule.id });
    }
    activeIds.add(rule.id);
    rules.push({ ...block, index });
  }

  return {
    rules,
    activeIds,
    supersessionEdges
  };
}

export function buildLockEntries(rules) {
  let previousChainSha256 = 'GENESIS';
  return rules.map(({ rule, raw }) => {
    const recordSha256 = sha256(canonicalJson(rule));
    const sourceSha256 = sha256(raw);
    const chainSha256 = sha256(
      `${previousChainSha256}\n${rule.id}\n${recordSha256}\n${sourceSha256}`
    );
    const entry = {
      schema: 1,
      id: rule.id,
      recordSha256,
      sourceSha256,
      previousChainSha256,
      chainSha256
    };
    previousChainSha256 = chainSha256;
    return entry;
  });
}

export function parseLockJsonl(lockText) {
  const lines = lockText.split(/\r?\n/).filter((line) => line.trim());
  return lines.map((line, index) => {
    const entry = parseJsonObject(line, `lock line ${index + 1}`);
    assertExactKeys(entry, LOCK_KEYS, `lock line ${index + 1}`);
    return entry;
  });
}

export function validateLock(rules, lockText, { allowMissingSuffix = false } = {}) {
  const actual = parseLockJsonl(lockText);
  const expected = buildLockEntries(rules);
  if (actual.length > expected.length) fail('lock has entries without rules');
  if (!allowMissingSuffix && actual.length !== expected.length) {
    fail(`lock has ${actual.length} entries for ${expected.length} rules`);
  }
  for (const [index, entry] of actual.entries()) {
    if (canonicalJson(entry) !== canonicalJson(expected[index])) {
      fail(`lock line ${index + 1} does not match immutable rule ${expected[index].id}`);
    }
  }
  return {
    actual,
    expected,
    missing: expected.slice(actual.length)
  };
}

export function validateHistoricalPrefix(
  currentContract,
  currentLockText,
  baseSpecText,
  baseLockText,
  label = 'Git baseline'
) {
  const baseContract = parseBusinessSpecMarkdown(baseSpecText);
  if (baseContract.rules.length > currentContract.rules.length) {
    fail(`${label} contains rules missing from the current specification`);
  }
  for (const [index, baseBlock] of baseContract.rules.entries()) {
    const currentBlock = currentContract.rules[index];
    if (!currentBlock || currentBlock.raw !== baseBlock.raw) {
      fail(`${label} immutable rule ${baseBlock.rule.id} was edited, deleted, reordered, or reformatted`);
    }
  }
  if (!currentLockText.startsWith(baseLockText)) {
    fail(`${label} lock prefix was edited, deleted, reordered, or reformatted`);
  }
}

function literalTestTitles(source) {
  const pattern = /\b(?:test|it)\s*\(\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g;
  return [...source.matchAll(pattern)].map((match) => {
    const literal = match[1];
    return {
      start: match.index + match[0].lastIndexOf(literal),
      end: match.index + match[0].lastIndexOf(literal) + literal.length,
      title: literal.slice(1, -1)
    };
  });
}

function markerTokens(value) {
  return [...value.matchAll(/\[BS:[^\]\r\n]*\]/g)].map((match) => ({
    token: match[0],
    index: match.index
  }));
}

function classifyMarker(token) {
  const coverage = COVERAGE_PATTERN.exec(token);
  if (coverage) return { kind: 'covers', id: coverage[1] };
  const retirement = RETIREMENT_PATTERN.exec(token);
  if (retirement) {
    return { kind: 'retires', oldId: retirement[1], newId: retirement[2] };
  }
  fail(`unknown marker ${token}`);
}

export function validateStaticCoverage(contract, testSources) {
  const knownIds = new Set(contract.rules.map(({ rule }) => rule.id));
  const validEdges = new Set(
    contract.supersessionEdges.map(({ oldId, newId }) => `${oldId}->${newId}`)
  );
  const coveredIds = new Set();
  const coveredEdges = new Set();
  const declaredMarkers = [];

  for (const { file, source } of testSources) {
    const titles = literalTestTitles(source);
    const sourceMarkers = markerTokens(source);
    for (const marker of sourceMarkers) {
      const title = titles.find(({ start, end }) => marker.index >= start && marker.index < end);
      if (!title) fail(`${file} has an orphan or dynamic business marker ${marker.token}`);
    }

    for (const { title } of titles) {
      const markers = markerTokens(title);
      if (markers.length === 0) continue;
      if (markers[0].index !== 0) fail(`${file} business markers must begin the literal test title`);
      const unique = new Set(markers.map(({ token }) => token));
      if (unique.size !== markers.length) fail(`${file} has a duplicate marker in one test title`);

      for (const { token } of markers) {
        const marker = classifyMarker(token);
        declaredMarkers.push({ ...marker, token, file, title });
        if (marker.kind === 'covers') {
          if (!knownIds.has(marker.id)) fail(`${file} covers unknown rule ${marker.id}`);
          coveredIds.add(marker.id);
          continue;
        }
        if (!knownIds.has(marker.oldId) || !knownIds.has(marker.newId)) {
          fail(`${file} retirement marker references an unknown rule`);
        }
        const edge = `${marker.oldId}->${marker.newId}`;
        if (!validEdges.has(edge)) fail(`${file} declares nonexistent supersession ${edge}`);
        coveredEdges.add(edge);
      }
    }
  }

  const missingRules = [...contract.activeIds].filter((id) => !coveredIds.has(id));
  if (missingRules.length) fail(`active rules lack executable coverage: ${missingRules.join(', ')}`);
  const missingEdges = [...validEdges].filter((edge) => !coveredEdges.has(edge));
  if (missingEdges.length) fail(`supersession edges lack retirement coverage: ${missingEdges.join(', ')}`);

  return {
    declaredMarkers,
    knownRuleIds: knownIds,
    requiredRuleIds: new Set(contract.activeIds),
    requiredEdges: validEdges
  };
}

export function validateRuntimeCoverage(testEvents, coverage) {
  const passedRuleIds = new Set();
  const passedEdges = new Set();
  const declaredTitles = new Set(coverage.declaredMarkers.map(({ title }) => title));

  for (const event of testEvents) {
    if (event?.skip || event?.todo || event?.expectFailure) continue;
    const title = String(event?.name || '');
    const tokens = markerTokens(title);
    if (tokens.length > 0 && !declaredTitles.has(title)) {
      fail(`runtime business markers came from an undeclared test title: ${title}`);
    }
    for (const { token } of tokens) {
      const marker = classifyMarker(token);
      if (marker.kind === 'covers') {
        if (!coverage.knownRuleIds.has(marker.id)) {
          fail(`runtime coverage references unknown rule ${marker.id}`);
        }
        passedRuleIds.add(marker.id);
      } else {
        const edge = `${marker.oldId}->${marker.newId}`;
        if (!coverage.requiredEdges.has(edge)) {
          fail(`runtime coverage references unknown supersession ${edge}`);
        }
        passedEdges.add(edge);
      }
    }
  }

  const missingRules = [...coverage.requiredRuleIds].filter((id) => !passedRuleIds.has(id));
  if (missingRules.length) fail(`active rules did not pass: ${missingRules.join(', ')}`);
  const missingEdges = [...coverage.requiredEdges].filter((edge) => !passedEdges.has(edge));
  if (missingEdges.length) fail(`supersession transitions did not pass: ${missingEdges.join(', ')}`);
}

export async function readTestSources() {
  const files = (await readdir(TESTS_URL))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort();
  return Promise.all(
    files.map(async (name) => ({
      file: `tests/${name}`,
      source: await readFile(new URL(name, TESTS_URL), 'utf8')
    }))
  );
}

async function readGitFile(ref, path) {
  try {
    const { stdout } = await execFileAsync('git', ['show', `${ref}:${path}`], {
      cwd: fileURLToPath(ROOT_URL),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    return stdout;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 128) return null;
    if (/does not exist|exists on disk, but not in|invalid object name|unknown revision/i.test(error.stderr || '')) {
      return null;
    }
    throw error;
  }
}

async function readGitHistoryRefs() {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '--format=%H', 'HEAD', '--', 'BUSINESS_SPEC.md'],
      {
        cwd: fileURLToPath(ROOT_URL),
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      }
    );
    return stdout.split(/\r?\n/).filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 128) return [];
    throw error;
  }
}

async function validateGitHistory(currentContract, currentLockText) {
  const refs = [
    ...(await readGitHistoryRefs()),
    'HEAD',
    'HEAD^',
    'origin/master',
    'origin/main'
  ];
  const seen = new Set();
  for (const ref of refs) {
    const [baseSpecText, baseLockText] = await Promise.all([
      readGitFile(ref, 'BUSINESS_SPEC.md'),
      readGitFile(ref, 'BUSINESS_SPEC.lock.jsonl')
    ]);
    if (baseSpecText === null && baseLockText === null) continue;
    if (baseSpecText === null || baseLockText === null) {
      fail(`${ref} contains only one business specification contract file`);
    }
    const fingerprint = sha256(`${baseSpecText}\n${baseLockText}`);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    validateHistoricalPrefix(currentContract, currentLockText, baseSpecText, baseLockText, ref);
  }
}

export async function loadBusinessSpecContract({
  allowMissingLockSuffix = false,
  validateGitHistory: shouldValidateGitHistory = true
} = {}) {
  const [markdown, lockText, testSources] = await Promise.all([
    readFile(SPEC_URL, 'utf8'),
    readFile(LOCK_URL, 'utf8').catch((error) => {
      if (error.code === 'ENOENT' && allowMissingLockSuffix) return '';
      throw error;
    }),
    readTestSources()
  ]);
  const contract = parseBusinessSpecMarkdown(markdown);
  if (shouldValidateGitHistory) {
    await validateGitHistory(contract, lockText);
  }
  const lock = validateLock(contract.rules, lockText, {
    allowMissingSuffix: allowMissingLockSuffix
  });
  const coverage = validateStaticCoverage(contract, testSources);
  return { ...contract, lock, coverage };
}

async function appendLockSuffix() {
  const contract = await loadBusinessSpecContract({ allowMissingLockSuffix: true });
  if (contract.lock.missing.length === 0) return 0;
  const existingText = await readFile(LOCK_URL, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const prefix = existingText && !existingText.endsWith('\n') ? '\n' : '';
  const suffix = contract.lock.missing.map((entry) => JSON.stringify(entry)).join('\n');
  await appendFile(LOCK_URL, `${prefix}${suffix}\n`, { encoding: 'utf8', mode: 0o644 });
  return contract.lock.missing.length;
}

async function main() {
  const command = process.argv[2];
  if (command === '--check') {
    const contract = await loadBusinessSpecContract();
    process.stdout.write(
      `Business specification OK: ${contract.rules.length} rules, ` +
      `${contract.activeIds.size} active, ${contract.coverage.declaredMarkers.length} test markers.\n`
    );
    return;
  }
  if (command === '--append-lock') {
    const appended = await appendLockSuffix();
    process.stdout.write(`Business specification lock appended: ${appended} entr${appended === 1 ? 'y' : 'ies'}.\n`);
    return;
  }
  fail('usage: business-spec-contract.mjs --check|--append-lock');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
