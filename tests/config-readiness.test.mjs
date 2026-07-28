import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { derivePopupView } from '../src/popup-view.js';

const source = await readFile(new URL('../src/config-readiness.js', import.meta.url), 'utf8');

function readiness() {
  const context = vm.createContext({ URL });
  vm.runInContext(source, context);
  return context.HHJA_CONFIG_READINESS;
}

const valid = {
  groqApiKey: 'gsk_test',
  resumeUrl: 'https://hh.ru/resume/abc123'
};

test('readiness requires all launch settings in stable order', () => {
  const result = readiness().evaluate({});
  assert.equal(result.ready, false);
  assert.deepEqual(Array.from(result.missing, (item) => item.code), [
    'ai_provider_api_key',
    'resume_url'
  ]);
  assert.deepEqual(Array.from(result.missing, (item) => item.label), [
    'ключ Qwen API',
    'ссылка на резюме hh.ru'
  ]);
});

test('readiness explicitly allows no-AI mode without keys but still requires a resume URL', () => {
  const missingResume = readiness().evaluate({
    aiEnabled: false,
    aiProvider: 'qwen',
    aiProviderCredentials: {}
  });
  assert.equal(missingResume.ready, false);
  assert.equal(missingResume.aiEnabled, false);
  assert.deepEqual(Array.from(missingResume.missing, (item) => item.code), ['resume_url']);

  const ready = readiness().evaluate({
    aiEnabled: false,
    aiProvider: 'qwen',
    aiProviderCredentials: {},
    resumeUrl: valid.resumeUrl
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(Array.from(ready.missing), []);
});

test('readiness selects provider credentials and preserves legacy Groq keys', () => {
  const qwen = readiness().evaluate({
    aiProvider: 'qwen',
    aiProviderCredentials: { qwen: { apiKey: 'sk-test' } },
    resumeUrl: valid.resumeUrl
  });
  assert.equal(qwen.ready, true);
  assert.equal(qwen.provider, 'qwen');

  const legacyGroq = readiness().evaluate(valid);
  assert.equal(legacyGroq.ready, true);
  assert.equal(legacyGroq.provider, 'groq');
});

test('readiness accepts regional https hh resume URLs', () => {
  assert.equal(readiness().evaluate({ ...valid, resumeUrl: 'https://ekaterinburg.hh.ru/resume/abc123' }).ready, true);
});

test('readiness rejects unsafe or non-resume URLs', () => {
  for (const resumeUrl of ['http://hh.ru/resume/abc', 'https://example.com/resume/abc', 'https://hh.ru/search/vacancy']) {
    assert.equal(readiness().evaluate({ ...valid, resumeUrl }).ready, false);
  }
});

test('readiness rejects a whitespace-only key but ignores internal prompts', () => {
  assert.equal(readiness().evaluate({
    ...valid,
    aiProvider: 'qwen',
    aiProviderCredentials: { qwen: { apiKey: '  ' } }
  }).ready, false);
  assert.equal(readiness().evaluate({ ...valid, coverPrompt: '  ', employerQuestionPrompt: null, choiceRetryPrompt: '' }).ready, true);
});

test('popup exposes not configured state and blocks start and continue', () => {
  const config = readiness().evaluate({});
  const view = derivePopupView({
    readiness: config,
    tabState: { kind: 'ready', canStartAutoApply: true, canContinueAutoApply: true }
  });
  assert.equal(view.status.title, 'НЕ НАСТРОЕНО');
  assert.equal(view.buttons.autoApplyDisabled, true);
  assert.equal(view.buttons.continueDisabled, true);
  assert.equal(view.buttons.refreshResumesDisabled, true);
});

test('popup reports intentional no-AI mode as ready and keeps launch actions available', () => {
  const config = readiness().evaluate({
    aiEnabled: false,
    resumeUrl: valid.resumeUrl
  });
  const view = derivePopupView({
    readiness: config,
    aiProviderStatus: { provider: 'qwen', label: 'Qwen', configured: false, enabled: false },
    tabState: { kind: 'ready', canStartAutoApply: true, canContinueAutoApply: true }
  });
  assert.equal(view.status.tone, 'ok');
  assert.equal(view.status.title, 'ГОТОВО, ИИ выключен');
  assert.equal(view.status.detail, 'Письма — по шаблону · вакансии с вопросами пропускаются');
  assert.equal(view.buttons.autoApplyDisabled, false);
  assert.equal(view.buttons.continueDisabled, false);
  assert.equal(view.buttons.refreshResumesDisabled, false);
});
