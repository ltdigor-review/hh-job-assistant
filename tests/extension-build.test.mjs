import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = new URL('../', import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'));
}

test('manifest is valid MV3 and exposes extension window UI', async () => {
  const manifest = await readJson('manifest.json');

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'src/background.js');
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.action.default_popup, 'src/popup.html');
  assert.equal(manifest.options_page, 'src/options.html');
  assert.ok(manifest.permissions.includes('windows'));
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('tabs'));
  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(manifest.host_permissions.includes('https://hh.ru/*'));
  assert.ok(manifest.host_permissions.includes('https://api.groq.com/*'));
});

test('javascript files parse', async () => {
  const files = [
    'src/background.js',
    'src/content-hh.js',
    'src/options.js',
    'src/popup.js',
    'scripts/hh-live-smoke.mjs'
  ];

  for (const file of files) {
    await execFileAsync(process.execPath, ['--check', file], {
      cwd: new URL('.', root)
    });
  }
});

test('background service worker avoids top-level await', async () => {
  const js = await readFile(new URL('src/background.js', root), 'utf8');

  assert.doesNotMatch(js.trim(), /await\s+ensureDefaults\(\);?$/);
  assert.match(js, /ensureDefaults\(\)\.catch/);
});

test('background initializes defaults and registers required listeners', async () => {
  const calls = [];
  const localData = {};

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
          calls.push(['storage.set', Object.keys(value)]);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() { calls.push(['runtime.onInstalled']); } },
      onStartup: { addListener() { calls.push(['runtime.onStartup']); } },
      onMessage: { addListener() { calls.push(['runtime.onMessage']); } }
    },
    alarms: {
      create() { calls.push(['alarms.create']); },
      onAlarm: { addListener() { calls.push(['alarms.onAlarm']); } }
    },
    tabs: {
      async get() {
        return { status: 'complete' };
      }
    },
    scripting: {},
    windows: {
      async get() {
        return null;
      },
      async update() {},
      async create() {
        calls.push(['windows.create']);
        return { id: 1 };
      },
      onRemoved: { addListener() { calls.push(['windows.onRemoved']); } }
    }
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}`);

  assert.equal(localData.groqModel, 'llama-3.3-70b-versatile');
  assert.equal(localData.dailyLimit, 10);
  assert.ok(calls.some(([name]) => name === 'runtime.onMessage'));
  assert.ok(calls.some(([name]) => name === 'windows.onRemoved'));
});

test('content script registers one message listener', async () => {
  const source = await readFile(new URL('src/content-hh.js', root), 'utf8');
  let listenerCount = 0;

  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener() {
          listenerCount += 1;
        }
      },
      sendMessage() {}
    },
    storage: {
      local: {
        async get() {
          return {};
        },
        async set() {}
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

  assert.equal(listenerCount, 1);
});

test('popup has controls wired to the extension window and actions', async () => {
  const html = await readFile(new URL('src/popup.html', root), 'utf8');
  const js = await readFile(new URL('src/popup.js', root), 'utf8');

  for (const id of ['dryRun', 'autoApply', 'stop', 'refreshResumes', 'openWindow', 'openOptions']) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(js, new RegExp(`getElementById\\('${id}'\\)`));
  }

  assert.match(js, /OPEN_ASSISTANT_WINDOW/);
  assert.match(js, /openOptionsPage/);
  assert.match(html, /window-mode/);
});

class FakeElement {
  constructor({ text = '', href = '', selectorMap = {}, click = null } = {}) {
    this.innerText = text;
    this.textContent = text;
    this.href = href;
    this.disabled = false;
    this.selectorMap = selectorMap;
    this.clickHandler = click;
    this.value = '';
    this.children = [];
    this.style = {};
  }

  querySelectorAll(selector) {
    if (selector.includes(',')) {
      return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
    }
    return this.selectorMap[selector] || [];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getBoundingClientRect() {
    return { width: 100, height: 24 };
  }

  getAttribute(name) {
    return name === 'aria-disabled' ? null : undefined;
  }

  dispatchEvent() {}

  scrollIntoView() {}

  append(...children) {
    this.children.push(...children);
  }

  remove() {}

  addEventListener() {}

  click() {
    this.clickHandler?.();
  }
}

async function runContentAutoApply({ dialogText, hasTextarea, groqResponse = { ok: false, error: 'Groq API key is not configured' } }) {
  const source = await readFile(new URL('src/content-hh.js', root), 'utf8');
  const appended = [];
  const states = [];
  let submitClicks = 0;
  let listener = null;
  let dialog = null;

  const textarea = new FakeElement({ text: '' });
  const closeButton = new FakeElement({ text: 'Закрыть' });
  const submitButton = new FakeElement({
    text: 'Отправить',
    click() {
      submitClicks += 1;
    }
  });
  const responseButton = new FakeElement({
    text: 'Откликнуться',
    click() {
      dialog = new FakeElement({
        text: dialogText,
        selectorMap: {
          '[data-qa="vacancy-response-popup-form-letter-input"]': hasTextarea ? [textarea] : [],
          '[data-qa="vacancy-response-letter-input"]': hasTextarea ? [textarea] : [],
          '[data-qa="vacancy-response-submit-popup"]': [submitButton],
          '[data-qa="vacancy-response-letter-submit"]': [submitButton],
          '[data-qa*="submit"]': [submitButton],
          textarea: hasTextarea ? [textarea] : [],
          '[data-qa="bloko-modal-close"]': [closeButton],
          button: [submitButton, closeButton]
        }
      });
    }
  });
  const titleLink = new FakeElement({
    text: 'Java Developer',
    href: 'https://hh.ru/vacancy/123'
  });
  const card = new FakeElement({
    text: 'Java Developer\nООО Test\nОткликнуться',
    selectorMap: {
      '[data-qa="serp-item__title"]': [titleLink],
      'a[href*="/vacancy/"]': [titleLink],
      '[data-qa="vacancy-serp__vacancy_response"]': [responseButton],
      '[data-qa="vacancy-response-link-top"]': [],
      '[data-qa="vacancy-response-link-bottom"]': [],
      'a[href*="vacancy_response"]': [],
      button: [responseButton]
    }
  });

  globalThis.location = {
    href: 'https://hh.ru/search/vacancy?text=java',
    pathname: '/search/vacancy'
  };
  globalThis.window = {
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;
  globalThis.Event = class Event {
    constructor(type) {
      this.type = type;
    }
  };
  globalThis.document = {
    title: 'HH test page',
    body: new FakeElement({ text: 'HH вакансии' }),
    querySelectorAll(selector) {
      if (selector.includes(',')) {
        return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
      }
      if (selector === '[data-qa="vacancy-serp__vacancy"]') return [card];
      if (selector === '[data-qa="serp-item"]') return [];
      if (selector === '[data-qa*="vacancy-serp"]') return [card];
      if (selector === '[role="dialog"]') return dialog ? [dialog] : [];
      if (selector === '[data-qa*="modal"]') return [];
      if (selector === '.bloko-modal') return [];
      if (selector === '.magritte-modal') return [];
      return [];
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    getElementById() {
      return null;
    },
    createElement() {
      return new FakeElement();
    }
  };
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      },
      sendMessage(message) {
        if (message.type === 'SET_RUN_STATE') {
          states.push(message.patch);
          return Promise.resolve({ ok: true });
        }
        if (message.type === 'APPEND_RUN_RESULT') {
          appended.push(message.item);
          return Promise.resolve({ ok: true });
        }
        if (message.type === 'GENERATE_COVER_LETTER') {
          return Promise.resolve(groqResponse);
        }
        return Promise.resolve({ ok: true });
      }
    },
    storage: {
      local: {
        async get() {
          return { dailyLimit: 1, delayMinMs: 1, delayMaxMs: 1 };
        },
        async set() {}
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${crypto.randomUUID()}`);
  assert.ok(listener, 'content script should register a listener');

  const response = await new Promise((resolve) => {
    const stayedAsync = listener({ type: 'START_AUTO_APPLY' }, {}, resolve);
    assert.equal(stayedAsync, true);
  });

  return { response, appended, states, submitClicks };
}

test('auto apply skips cover-letter vacancy when Groq key is missing', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Добавьте сопроводительное письмо\nОтправить',
    hasTextarea: true
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.appended.at(-1).status, 'skipped_missing_groq_key');
  assert.equal(result.appended.at(-1).error, 'Groq API key is not configured');
});

test('auto apply skips test vacancy when Groq key is missing', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Тест\nОтветьте на вопросы работодателя',
    hasTextarea: false
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.appended.at(-1).status, 'skipped_test_missing_groq_key');
  assert.equal(result.appended.at(-1).testDetected, true);
});

test('auto apply submits test vacancy after Groq assistance', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Тест\nОтветьте на вопросы работодателя\nОтправить',
    hasTextarea: false,
    groqResponse: { ok: true, text: 'Краткая подсказка по тесту' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
  assert.equal(result.appended.at(-1).testDetected, true);
});
