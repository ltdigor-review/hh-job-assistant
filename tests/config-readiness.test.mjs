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
  resumeUrl: 'https://hh.ru/resume/abc123',
  coverPrompt: 'cover',
  employerQuestionPrompt: 'questions',
  choiceRetryPrompt: 'choices'
};

test('readiness requires all launch settings in stable order', () => {
  const result = readiness().evaluate({});
  assert.equal(result.ready, false);
  assert.deepEqual(Array.from(result.missing, (item) => item.code), [
    'groq_api_key',
    'resume_url',
    'cover_prompt',
    'employer_question_prompt',
    'choice_retry_prompt'
  ]);
});

test('readiness accepts regional https hh resume URLs and all prompts', () => {
  assert.equal(readiness().evaluate({ ...valid, resumeUrl: 'https://ekaterinburg.hh.ru/resume/abc123' }).ready, true);
});

test('readiness rejects unsafe or non-resume URLs', () => {
  for (const resumeUrl of ['http://hh.ru/resume/abc', 'https://example.com/resume/abc', 'https://hh.ru/search/vacancy']) {
    assert.equal(readiness().evaluate({ ...valid, resumeUrl }).ready, false);
  }
});

test('readiness rejects whitespace-only prompts and key', () => {
  for (const key of ['groqApiKey', 'coverPrompt', 'employerQuestionPrompt', 'choiceRetryPrompt']) {
    assert.equal(readiness().evaluate({ ...valid, [key]: '  ' }).ready, false);
  }
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
