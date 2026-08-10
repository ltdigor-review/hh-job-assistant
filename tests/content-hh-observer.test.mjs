import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);

async function readDomOwnerSource() {
  return readFile(new URL('src/content-hh-observer.js', root), 'utf8');
}

function loadObserver(source) {
  const document = { body: {}, title: '', querySelectorAll: () => [], querySelector: () => null };
  const context = {
    URL,
    document,
    location: {
      href: 'https://hh.ru/search/vacancy',
      origin: 'https://hh.ru',
      pathname: '/search/vacancy'
    },
    HHJobAssistantText: {
      cleanText(value) {
        return String(value || '').replace(/\r/g, '').trim();
      }
    },
    HHJobAssistantDom: {
      textOf: (node) => String(node?.textContent || ''),
      isVisible: () => true,
      queryFirst: () => null,
      queryAll: () => [],
      findClickableByText: () => null,
      isDisabled: () => false,
      findEnabledClickableByText: () => null
    }
  };
  context.globalThis = context;
  context.window = context;
  vm.runInNewContext(source, context);
  return context.HHJobAssistantHhObserver;
}

test('HH observer exposes only the frozen versioned capture API', async () => {
  const observer = loadObserver(await readDomOwnerSource());

  assert.deepEqual(Reflect.ownKeys(observer), [
    'schemaVersion',
    'capturePage',
    'captureSearch',
    'captureResponse',
    'captureQuestionForm',
    'capturePagination',
    'readControlState'
  ]);
  assert.equal(observer.schemaVersion, 1);
  assert.equal(Object.isFrozen(observer), true);
  assert.equal(observer.readControlState(null).connected, false);

  const responseRoot = { textContent: 'Вы откликнулись', querySelectorAll: () => [] };
  assert.equal(observer.captureResponse({ root: responseRoot, item: { vacancyId: '123' } }).facts.alreadyApplied, true);
});

test('HH question captures are synchronous, fresh, and split facts from refs', async () => {
  const observer = loadObserver(await readDomOwnerSource());
  const makeField = () => ({
    tagName: 'TEXTAREA',
    textContent: '',
    value: '',
    required: true,
    parentElement: { textContent: 'Опишите релевантный проект?' },
    getAttribute(name) {
      return ({ name: 'task_1_text', 'aria-label': 'Опишите релевантный проект?', type: 'text' })[name] || '';
    },
    closest: () => null
  });
  let currentField = makeField();
  const rootNode = {
    textContent: 'Опишите релевантный проект?',
    querySelectorAll(selector) {
      if (selector === '[data-qa="task-body"]') return [];
      if (selector.includes('textarea,input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')) return [currentField];
      if (selector.includes('input[type="checkbox"],input[type="radio"]')) return [];
      return [];
    }
  };

  const first = observer.captureQuestionForm(rootNode);
  const replacement = makeField();
  currentField = replacement;
  const second = observer.captureQuestionForm(rootNode);

  assert.equal(first.facts.signature, second.facts.signature);
  assert.equal(first.refs.textFields[0] === second.refs.textFields[0], false);
  assert.equal(second.refs.textFields[0], replacement);
  assert.equal('field' in second.facts.textQuestions[0], false);
});

test('HH question IDs stay legacy-stable when visible answer text shifts after a rerender', async () => {
  const observer = loadObserver(await readDomOwnerSource());
  const makeField = (name) => ({
    tagName: 'TEXTAREA',
    textContent: '',
    value: '',
    required: true,
    parentElement: {
      textContent: 'Писать тут',
      getAttribute(attribute) {
        return attribute === 'data-qa' ? 'textarea-native-wrapper' : '';
      }
    },
    getAttribute(attribute) {
      return ({ name, type: 'text' })[attribute] || '';
    },
    closest: () => null
  });
  let fields = [makeField('task_1_text'), makeField('task_2_text')];
  const rootNode = {
    textContent: 'Укажите город проживания\nПисать тут\nУкажите желаемый доход\nПисать тут',
    querySelectorAll(selector) {
      if (selector === '[data-qa="task-body"]') return [];
      if (selector.includes('textarea,input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')) return fields;
      if (selector.includes('input[type="checkbox"],input[type="radio"]')) return [];
      return [];
    }
  };

  const before = observer.captureQuestionForm(rootNode);
  const stableQuestionHash = (value) => {
    let hash = 0x811c9dc5;
    for (const character of String(value || '')) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  const legacyMarker = 'task_1_text\n\n\n\nПисать тут';
  assert.equal(before.facts.textQuestions[0].id, `text-1-${stableQuestionHash(`${legacyMarker}\n${legacyMarker}`)}`);
  fields = [makeField('task_1_text'), makeField('task_2_text')];
  fields[0].value = 'Москва';
  fields[0].parentElement.textContent = 'МоскваМосква\u200b';
  rootNode.textContent = 'Москва\nУкажите желаемый доход\n600000';
  const after = observer.captureQuestionForm(rootNode);

  assert.deepEqual(
    after.facts.textQuestions.map(({ id }) => id),
    before.facts.textQuestions.map(({ id }) => id)
  );
  assert.equal(after.facts.signature, before.facts.signature);
});

test('HH observer has no waits, mutations, events, Chrome APIs, or network calls', async () => {
  const source = await readDomOwnerSource();
  assert.doesNotMatch(source, /\b(?:MutationObserver|setTimeout|setInterval|fetch)\b|\.click\s*\(|setNativeValue|dispatchEvent|addEventListener|chrome\.(?:runtime|storage)/);
  assert.doesNotMatch(source, /__hhjaQuestion/);
});

test('HH runtime cannot regain HH selector traversal', async () => {
  const source = await readFile(new URL('src/content-hh.js', root), 'utf8');
  assert.doesNotMatch(source, /HH_SELECTORS|data-qa=["'][^"']*vacancy|querySelector(?:All)?\s*\(|\.closest\s*\(|\.matches\s*\(|queryFirst\s*\(|queryAll\s*\(|find(?:Enabled)?ClickableByText\s*\(/);
});

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
