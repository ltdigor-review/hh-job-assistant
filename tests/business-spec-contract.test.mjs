import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLockEntries,
  parseBusinessSpecMarkdown,
  validateHistoricalPrefix,
  validateLock,
  validateRuntimeCoverage,
  validateStaticCoverage,
} from '../scripts/business-spec-contract.mjs';

function rule(number, supersedes = [], overrides = {}) {
  return {
    schema: 1,
    kind: 'business-rule',
    id: `HHJA-BR-${String(number).padStart(6, '0')}`,
    scope: 'contract-test',
    requirement: `The product MUST preserve contract rule ${number}.`,
    acceptance: [`Contract rule ${number} is executable.`],
    supersedes,
    introduced: '2026-07-28',
    ...overrides
  };
}

function block(value, raw = JSON.stringify(value, null, 2)) {
  return [
    '<!-- BUSINESS_SPEC_RULE_BEGIN -->',
    '```json',
    raw,
    '```',
    '<!-- BUSINESS_SPEC_RULE_END -->'
  ].join('\n');
}

function markdown(values) {
  return values.map((value) => block(value)).join('\n\n');
}

function lockText(contract) {
  return `${buildLockEntries(contract.rules).map((entry) => JSON.stringify(entry)).join('\n')}\n`;
}

function marker(kind, value) {
  return ['[BS', kind, `${value}]`].join(':');
}

function coverageSource(entries) {
  return entries.map((entry, index) => `test('${entry} behavior ${index}', () => {});`).join('\n');
}

test('business specification contract accepts immutable rules, coverage, and passing TAP', () => {
  const first = rule(1);
  const second = rule(2, [first.id]);
  const contract = parseBusinessSpecMarkdown(markdown([first, second]));
  validateLock(contract.rules, lockText(contract));
  const covers = marker('COVERS', second.id);
  const retires = marker('RETIRES', `${first.id}:BY:${second.id}`);
  const coverage = validateStaticCoverage(contract, [{
    file: 'tests/behavior.test.mjs',
    source: coverageSource([`${covers}${retires}`])
  }]);
  validateRuntimeCoverage([{ name: `${covers}${retires} behavior 0` }], coverage);
});

test('business specification contract rejects malformed blocks, keys, ids, and supersession', () => {
  assert.throws(
    () => parseBusinessSpecMarkdown(`${block(rule(1))}\n<!-- BUSINESS_SPEC_RULE_BEGIN -->`),
    /malformed or unbalanced/
  );
  assert.throws(
    () => parseBusinessSpecMarkdown(markdown([rule(1, [], { unexpected: true })])),
    /unknown: unexpected/
  );
  const duplicateKeyRaw = JSON.stringify(rule(1), null, 2).replace(
    '  "scope":',
    '  "scope": "duplicate",\n  "scope":'
  );
  assert.throws(
    () => parseBusinessSpecMarkdown(block(null, duplicateKeyRaw)),
    /duplicate JSON key "scope"/
  );
  assert.throws(
    () => parseBusinessSpecMarkdown(markdown([rule(2)])),
    /contiguous id HHJA-BR-000001/
  );
  assert.throws(
    () => parseBusinessSpecMarkdown(markdown([rule(1, ['HHJA-BR-000002']), rule(2)])),
    /missing, forward, or already retired/
  );
  assert.throws(
    () => parseBusinessSpecMarkdown(markdown([
      rule(1),
      rule(2, [rule(1).id]),
      rule(3, [rule(1).id])
    ])),
    /missing, forward, or already retired/
  );
});

test('business specification lock rejects semantic drift, source reformatting, and broken chains', () => {
  const contract = parseBusinessSpecMarkdown(markdown([rule(1), rule(2)]));
  const validLock = lockText(contract);
  validateLock(contract.rules, validLock);

  const changed = parseBusinessSpecMarkdown(markdown([
    rule(1, [], { requirement: 'The product MUST preserve changed semantics.' }),
    rule(2)
  ]));
  assert.throws(() => validateLock(changed.rules, validLock), /does not match immutable rule/);

  const reformatted = parseBusinessSpecMarkdown([
    block(rule(1), JSON.stringify(rule(1))),
    block(rule(2))
  ].join('\n\n'));
  assert.throws(() => validateLock(reformatted.rules, validLock), /does not match immutable rule/);

  const entries = buildLockEntries(contract.rules);
  entries[1] = { ...entries[1], previousChainSha256: 'broken' };
  assert.throws(
    () => validateLock(contract.rules, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`),
    /does not match immutable rule/
  );
  assert.throws(
    () => validateLock(contract.rules, `${JSON.stringify(entries[0])}\n`),
    /entries for 2 rules/
  );
});

test('business specification lock cannot bless rewritten history after trailing lock deletion', () => {
  const base = parseBusinessSpecMarkdown(markdown([rule(1), rule(2)]));
  const baseSpec = markdown([rule(1), rule(2)]);
  const baseLock = lockText(base);
  const rewritten = parseBusinessSpecMarkdown(markdown([
    rule(1),
    rule(2, [], { requirement: 'The product MUST NOT rewrite historical rule two.' }),
    rule(3)
  ]));
  const shortenedLock = `${JSON.stringify(buildLockEntries(base.rules)[0])}\n`;

  assert.throws(
    () => validateHistoricalPrefix(rewritten, shortenedLock, baseSpec, baseLock, 'HEAD'),
    /immutable rule HHJA-BR-000002 was edited/
  );
});

test('business specification coverage rejects missing, orphan, unknown, and invalid retirement markers', () => {
  const first = rule(1);
  const second = rule(2, [first.id]);
  const contract = parseBusinessSpecMarkdown(markdown([first, second]));
  const covers = marker('COVERS', second.id);
  const retires = marker('RETIRES', `${first.id}:BY:${second.id}`);

  assert.throws(
    () => validateStaticCoverage(contract, [{
      file: 'tests/missing.test.mjs',
      source: coverageSource([covers])
    }]),
    /supersession edges lack retirement coverage/
  );
  assert.throws(
    () => validateStaticCoverage(contract, [{
      file: 'tests/dynamic.test.mjs',
      source: `test(\`${covers} dynamic\`, () => {});`
    }]),
    /orphan or dynamic/
  );
  assert.throws(
    () => validateStaticCoverage(contract, [{
      file: 'tests/unknown.test.mjs',
      source: coverageSource([marker('COVERS', 'HHJA-BR-999999')])
    }]),
    /unknown rule/
  );
  assert.throws(
    () => validateStaticCoverage(contract, [{
      file: 'tests/edge.test.mjs',
      source: coverageSource([
        `${covers}${marker('RETIRES', `${second.id}:BY:${first.id}`)}`
      ])
    }]),
    /nonexistent supersession/
  );
  assert.doesNotThrow(() => validateStaticCoverage(contract, [{
    file: 'tests/valid.test.mjs',
    source: coverageSource([`${covers}${retires}`])
  }]));
});

test('business specification runtime coverage rejects skipped and unexecuted rule tests', () => {
  const contract = parseBusinessSpecMarkdown(markdown([rule(1)]));
  const covers = marker('COVERS', rule(1).id);
  const coverage = validateStaticCoverage(contract, [{
    file: 'tests/behavior.test.mjs',
    source: coverageSource([covers])
  }]);

  assert.throws(
    () => validateRuntimeCoverage([{ name: `${covers} behavior 0`, skip: true }], coverage),
    /active rules did not pass/
  );
  assert.throws(
    () => validateRuntimeCoverage([{ name: `${covers} behavior 0`, expectFailure: true }], coverage),
    /active rules did not pass/
  );
  assert.throws(
    () => validateRuntimeCoverage([], coverage),
    /active rules did not pass/
  );
  assert.doesNotThrow(
    () => validateRuntimeCoverage([{ name: `${covers} behavior 0` }], coverage)
  );
  assert.throws(
    () => validateRuntimeCoverage([{ name: `${covers} forged title` }], coverage),
    /undeclared test title/
  );
});
