import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../scripts/chromium-configure-extension.mjs', import.meta.url), 'utf8');

function loadPickConfig(environment = {}) {
  const start = source.indexOf('function pickConfig(fileEnv)');
  const end = source.indexOf('\nfunction connectWebSocket', start);
  assert.ok(start >= 0 && end > start, 'pickConfig helper must remain discoverable');

  const context = vm.createContext({ process: { env: environment } });
  vm.runInContext(`${source.slice(start, end)}\nthis.pickConfig = pickConfig;`, context);
  return context.pickConfig;
}

test('Chromium configuration preserves supported daily limits up to 200', () => {
  const pickConfig = loadPickConfig({ HHJA_DAILY_LIMIT: '150' });
  const result = pickConfig({});

  assert.equal(result.dailyLimit, 150);
});
