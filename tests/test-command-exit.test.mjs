import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('test summary fails when node reports cancelled tests with exit code zero', async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'hhja-test-summary-'));
  const fakeNpm = join(fixtureDir, 'npm');
  const logFile = join(fixtureDir, 'summary.log');

  try {
    await writeFile(fakeNpm, `#!/usr/bin/env bash
printf '%s\n' \
  'TAP version 13' \
  'not ok 1 - browser flow' \
  '  failureType: cancelledByParent' \
  '# tests 1' \
  '# pass 0' \
  '# fail 0' \
  '# cancelled 1'
exit 0
`, 'utf8');
    await chmod(fakeNpm, 0o755);

    const result = spawnSync('bash', ['scripts/test-summary.sh'], {
      cwd: new URL('../', import.meta.url),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixtureDir}${delimiter}${process.env.PATH || ''}`,
        HHJA_TEST_LOG: logFile,
        HHJA_TEST_TAIL: '20'
      }
    });

    assert.equal(await readFile(logFile, 'utf8').then((text) => text.includes('# cancelled 1')), true);
    assert.notEqual(
      result.status,
      0,
      `cancelled tests must fail validation, but wrapper exited 0:\n${result.stdout}${result.stderr}`
    );
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
