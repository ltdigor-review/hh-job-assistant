import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

async function readDomOwnerSource() {
  try {
    return await readFile(new URL('src/content-hh-observer.js', root), 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return readFile(new URL('src/content-hh.js', root), 'utf8');
  }
}

test('HH DOM owner preserves stable structural selector priority', async () => {
  const source = await readDomOwnerSource();

  assert.match(source, /\[data-qa="vacancy-serp__vacancy_response"\]/);
  assert.match(source, /\[data-qa="vacancy-response-link-top"\]/);
  assert.match(source, /\[data-qa="vacancy-response-letter-submit"\]/);
  assert.match(source, /a\[data-qa="pager-next"\]/);
  assert.match(source, /a\[rel="next"\]/);
});

test('HH DOM owner scopes active response surfaces before broad text fallbacks', async () => {
  const source = await readDomOwnerSource();

  assert.match(source, /function getDialogRoot\([\s\S]*\[role="dialog"\][\s\S]*\[data-qa\*="modal"\]/);
  assert.match(source, /function hasActiveResponseControl/);
  assert.match(source, /if \(!ignoreActiveResponseControl && hasActiveResponseControl\(root, item\)\) return false/);
});

test('HH DOM owner preserves cover-letter and employer-question distinction', async () => {
  const source = await readDomOwnerSource();

  assert.match(source, /vacancy-response-letter-input/);
  assert.match(source, /vacancy-response-letter-submit/);
  assert.match(source, /textarea,input:not\(\[type="hidden"\]\),\[contenteditable="true"\],\[role="textbox"\]/);
  assert.match(source, /function findQuestionFields/);
  assert.match(source, /function findQuestionControlGroups/);
});

test('HH DOM owner preserves interruption and confirmation detectors', async () => {
  const source = await readDomOwnerSource();

  assert.match(source, /function detectHhDailyResponseLimit/);
  assert.match(source, /\[data-qa="vacancy-response-error-notification"\]/);
  assert.match(source, /function detectBlockedResponseReason/);
  assert.match(source, /function findFollowupConfirmButton/);
  assert.match(source, /function hasSubmitControl/);
});
