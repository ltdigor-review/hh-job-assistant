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

test('manifest is valid MV3 and exposes popup UI', async () => {
  const manifest = await readJson('manifest.json');

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'src/background.js');
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.action.default_popup, 'src/popup.html');
  assert.equal(manifest.options_page, 'src/options.html');
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('tabs'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(!manifest.permissions.includes('windows'));
  assert.ok(!manifest.permissions.includes('alarms'));
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
  const localData = { dailyLimit: 10 };

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
    tabs: {
      async get() {
        return { status: 'complete' };
      }
    },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}`);

  assert.equal(localData.groqModel, 'llama-3.3-70b-versatile');
  assert.equal(localData.expectedSalary, '');
  assert.equal(localData.resumeUrl, '');
  assert.equal(localData.dailyLimit, 20);
  assert.ok(calls.some(([name]) => name === 'runtime.onMessage'));
});

test('test assistance prompt includes resume, vacancy, question text, and expected salary', async () => {
  let listener = null;
  let requestBody = null;

  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'Ответ' } }] };
      }
    };
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const data = {
            groqApiKey: 'gsk_test',
            groqModel: 'test-model',
            resumeText: 'Java developer, Spring Boot',
            expectedSalary: '250 000 руб. на руки',
            coverPrompt: 'cover prompt'
          };
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, data[key]]));
          }
          return {};
        },
        async set() {}
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    tabs: {
      async get() {
        return { status: 'complete' };
      }
    },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);

  const response = await new Promise((resolve) => {
    const stayedAsync = listener(
      {
        type: 'GENERATE_COVER_LETTER',
        task: 'test_assist',
        vacancyText: 'Вакансия: Java developer',
        extraText: 'Какую зарплату ожидаете?'
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  assert.equal(requestBody.model, 'test-model');
  const userContent = requestBody.messages.find((message) => message.role === 'user').content;
  assert.match(userContent, /Java developer, Spring Boot/);
  assert.match(userContent, /250 000 руб\. на руки/);
  assert.match(userContent, /Вакансия: Java developer/);
  assert.match(userContent, /Какую зарплату ожидаете\?/);
});

test('Groq prompt parses configured hh resume URL for resume context', async () => {
  let listener = null;
  let requestBody = null;
  let removedTabId = null;
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeUrl: 'https://hh.ru/resume/abc123',
    resumeParsedText: '',
    resumeParsedAt: '',
    expectedSalary: '',
    coverPrompt: 'cover prompt'
  };

  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'Письмо' } }] };
      }
    };
  };

  globalThis.location = { pathname: '/resume/abc123' };
  globalThis.document = {
    title: 'Java Developer resume',
    body: new FakeElement({ text: 'Java developer parsed from hh resume' }),
    querySelector(selector) {
      if (selector === 'main') return new FakeElement({ text: 'Java developer parsed from hh resume' });
      return null;
    }
  };

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
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    tabs: {
      async create({ url }) {
        return { id: 41, url, status: 'complete' };
      },
      async get() {
        return { status: 'complete' };
      },
      async remove(id) {
        removedTabId = id;
      },
      onUpdated: {
        addListener() {},
        removeListener() {}
      }
    },
    scripting: {
      async executeScript({ func }) {
        return [{ result: await func() }];
      }
    }
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);

  const response = await new Promise((resolve) => {
    const stayedAsync = listener(
      {
        type: 'GENERATE_COVER_LETTER',
        task: 'cover_letter',
        vacancyText: 'Вакансия: Java developer'
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  const userContent = requestBody.messages.find((message) => message.role === 'user').content;
  assert.match(userContent, /Java developer parsed from hh resume/);
  assert.equal(localData.resumeParsedText, 'Java developer parsed from hh resume');
  assert.equal(removedTabId, 41);
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

test('popup has ordered controls wired to Groq key, results, and actions', async () => {
  const html = await readFile(new URL('src/popup.html', root), 'utf8');
  const js = await readFile(new URL('src/popup.js', root), 'utf8');

  for (const id of ['dryRun', 'autoApply', 'stop', 'refreshResumes', 'openOptions', 'groqApiKey', 'saveGroqKey', 'testGroq', 'recentResults']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.ok(html.indexOf('id="dryRun"') < html.indexOf('id="autoApply"'));
  assert.ok(html.indexOf('id="autoApply"') < html.indexOf('id="stop"'));
  assert.ok(html.indexOf('id="stop"') < html.indexOf('id="refreshResumes"'));
  assert.doesNotMatch(html, /openWindow|Открыть окном|window-mode/);
  assert.doesNotMatch(js, /OPEN_ASSISTANT_WINDOW|openWindow/);
  assert.match(js, /openOptionsPage/);
  assert.match(js, /TEST_GROQ/);
  assert.match(js, /skipped_missing_groq_key/);
});

test('options use hh resume URL instead of pasted resume text or daily refresh toggle', async () => {
  const html = await readFile(new URL('src/options.html', root), 'utf8');
  const js = await readFile(new URL('src/options.js', root), 'utf8');

  assert.match(html, /id="resumeUrl"/);
  assert.match(js, /resumeUrl/);
  assert.doesNotMatch(html, /id="resumeText"|Resume text|resumeRefreshEnabled|Enable daily resume refresh/);
  assert.doesNotMatch(js, /resumeText|resumeRefreshEnabled/);
});

class FakeElement {
  constructor({ text = '', href = '', selectorMap = {}, click = null, attrs = {} } = {}) {
    this.innerText = text;
    this.textContent = text;
    this.href = href;
    this.disabled = false;
    this.selectorMap = selectorMap;
    this.clickHandler = click;
    this.value = '';
    this.children = [];
    this.style = {};
    this.attrs = attrs;
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
    if (name === 'aria-disabled') return null;
    return this.attrs[name] ?? null;
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

async function runBackgroundResumeRefresh({ clickButtons }) {
  let listener = null;
  let tabId = 0;
  const localData = {};
  const removedTabs = [];
  const tabStatuses = new Map();

  globalThis.window = {
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;

  const resumeLink = new FakeElement({ href: 'https://hh.ru/resume/abc123' });

  function setDocumentForList() {
    globalThis.location = { pathname: '/applicant/resumes' };
    globalThis.document = {
      title: 'My resumes',
      body: new FakeElement({ text: 'Мои резюме' }),
      querySelectorAll(selector) {
        if (selector.includes(',')) {
          return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
        }
        if (selector === 'a[href*="/resume/"]') return [resumeLink];
        return [];
      }
    };
  }

  function setDocumentForResume() {
    globalThis.location = { pathname: '/resume/abc123' };
    globalThis.document = {
      title: 'Java Developer',
      body: new FakeElement({ text: 'Java Developer resume' }),
      querySelectorAll(selector) {
        if (selector.includes(',')) {
          return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
        }
        if (selector === 'button' || selector === 'a' || selector === '[role="button"]') return clickButtons;
        return [];
      }
    };
  }

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
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    alarms: {
      create() {},
      onAlarm: { addListener() {} }
    },
    tabs: {
      async create({ url }) {
        tabId += 1;
        tabStatuses.set(tabId, 'complete');
        return { id: tabId, url, status: 'complete' };
      },
      async get(id) {
        return { status: tabStatuses.get(id) || 'complete' };
      },
      async remove(id) {
        removedTabs.push(id);
      },
      onUpdated: {
        addListener() {},
        removeListener() {}
      }
    },
    scripting: {
      async executeScript({ func }) {
        if (func.name === 'collectResumeLinksScript') {
          setDocumentForList();
        } else {
          setDocumentForResume();
        }
        return [{ result: await func() }];
      }
    },
    windows: {
      async get() {
        return null;
      },
      async update() {},
      async create() {
        return { id: 1 };
      },
      onRemoved: { addListener() {} }
    }
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);

  const response = await new Promise((resolve) => {
    const stayedAsync = listener({ type: 'REFRESH_RESUMES_NOW' }, {}, resolve);
    assert.equal(stayedAsync, true);
  });

  return { response, localData, removedTabs };
}

test('resume refresh continues when Chrome tab status stays loading after DOM is ready', async () => {
  let listener = null;
  let tabId = 0;
  let raiseClicks = 0;
  const localData = {};
  const removedTabs = [];
  const resumeLink = new FakeElement({ href: 'https://hh.ru/resume/abc123' });
  const raiseButton = new FakeElement({ text: 'Поднять в поиске', click() { raiseClicks += 1; } });

  globalThis.window = {
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;

  function setDocumentForList() {
    globalThis.location = { pathname: '/applicant/resumes' };
    globalThis.document = {
      readyState: 'interactive',
      title: 'My resumes',
      body: new FakeElement({ text: 'Мои резюме' }),
      querySelectorAll(selector) {
        if (selector.includes(',')) {
          return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
        }
        if (selector === 'a[href*="/resume/"]') return [resumeLink];
        return [];
      }
    };
  }

  function setDocumentForResume() {
    globalThis.location = { pathname: '/resume/abc123' };
    globalThis.document = {
      readyState: 'interactive',
      title: 'Java Developer',
      body: new FakeElement({ text: 'Java Developer resume' }),
      querySelectorAll(selector) {
        if (selector.includes(',')) {
          return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
        }
        if (selector === 'button' || selector === 'a' || selector === '[role="button"]') return [raiseButton];
        return [];
      }
    };
  }

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
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    tabs: {
      async create({ url }) {
        tabId += 1;
        if (/\/applicant\/resumes/.test(url)) {
          setDocumentForList();
        } else {
          setDocumentForResume();
        }
        return { id: tabId, url, status: 'loading' };
      },
      async get() {
        return { status: 'loading' };
      },
      async remove(id) {
        removedTabs.push(id);
      },
      onUpdated: {
        addListener() {},
        removeListener() {}
      }
    },
    scripting: {
      async executeScript({ func }) {
        return [{ result: await func() }];
      }
    }
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);

  const response = await new Promise((resolve) => {
    const stayedAsync = listener({ type: 'REFRESH_RESUMES_NOW' }, {}, resolve);
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  assert.equal(raiseClicks, 1);
  assert.equal(removedTabs.length, 2);
});

test('resume refresh clicks raise/update controls', async () => {
  let raiseClicks = 0;
  let editClicks = 0;
  const buttons = [
    new FakeElement({ text: 'Редактировать', click() { editClicks += 1; } }),
    new FakeElement({ text: 'Поднять в поиске', click() { raiseClicks += 1; } })
  ];

  const { response, localData, removedTabs } = await runBackgroundResumeRefresh({ clickButtons: buttons });

  assert.equal(response.ok, true);
  assert.equal(raiseClicks, 1);
  assert.equal(editClicks, 0);
  assert.equal(localData.runState.state, 'idle');
  assert.equal(removedTabs.length, 2);
});

test('resume refresh does not report success after edit/save controls', async () => {
  let clicks = 0;
  const buttons = [
    new FakeElement({ text: 'Редактировать', click() { clicks += 1; } }),
    new FakeElement({ text: 'Сохранить', click() { clicks += 1; } })
  ];

  const { response, localData } = await runBackgroundResumeRefresh({ clickButtons: buttons });

  assert.equal(response.ok, false);
  assert.equal(clicks, 0);
  assert.equal(response.error, '1 resume refresh actions failed');
  assert.equal(localData.runState.state, 'error');
});

async function runContentAutoApply({
  dialogText,
  hasTextarea,
  startOnResponseForm = false,
  hasQuestionField = false,
  hasCoverLetterField = false,
  bodyText = 'HH вакансии',
  responseHref = '',
  expectedSalary = '',
  followupDialogText = '',
  followupConfirmText = 'Все равно откликнуться',
  groqResponse = { ok: false, error: 'Groq API key is not configured' }
}) {
  const source = await readFile(new URL('src/content-hh.js', root), 'utf8');
  const appended = [];
  const states = [];
  let submitClicks = 0;
  let followupClicks = 0;
  let navigateUrl = '';
  let listener = null;
  let dialog = null;
  const localStore = {};

  const textarea = new FakeElement({
    text: hasQuestionField ? 'Писать тут' : '',
    attrs: hasQuestionField ? { name: 'task_235076159_text' } : {}
  });
  const coverTextarea = new FakeElement({
    text: hasCoverLetterField ? 'Сопроводительное письмо обязательное' : '',
    attrs: hasCoverLetterField ? { 'data-qa': 'vacancy-response-letter-input' } : {}
  });
  const closeButton = new FakeElement({ text: 'Закрыть' });
  const followupConfirmButton = new FakeElement({
    text: followupConfirmText,
    click() {
      followupClicks += 1;
      dialog = null;
    }
  });
  const submitButton = new FakeElement({
    text: 'Отправить',
    click() {
      submitClicks += 1;
      if (followupDialogText) {
        dialog = new FakeElement({
          text: followupDialogText,
          selectorMap: {
            '[data-qa="bloko-modal-close"]': [closeButton],
            button: [followupConfirmButton, closeButton]
          }
        });
      }
    }
  });
  const responseButton = new FakeElement({
    text: 'Откликнуться',
    href: responseHref,
    click() {
      dialog = new FakeElement({
        text: dialogText,
        selectorMap: {
          '[data-qa="vacancy-response-popup-form-letter-input"]': hasCoverLetterField ? [coverTextarea] : hasTextarea ? [textarea] : [],
          '[data-qa="vacancy-response-letter-input"]': hasCoverLetterField ? [coverTextarea] : hasTextarea ? [textarea] : [],
          '[data-qa="vacancy-response-submit-popup"]': [submitButton],
          '[data-qa="vacancy-response-letter-submit"]': [submitButton],
          '[data-qa*="submit"]': [submitButton],
          textarea: [hasQuestionField || hasTextarea ? textarea : null, hasCoverLetterField ? coverTextarea : null].filter(Boolean),
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

  globalThis.location = startOnResponseForm
    ? {
        href: 'https://hh.ru/applicant/vacancy_response?vacancyId=123',
        pathname: '/applicant/vacancy_response'
      }
    : {
        href: 'https://hh.ru/search/vacancy?text=java',
        pathname: '/search/vacancy'
      };
  globalThis.window = {
    __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
    __HH_JOB_ASSISTANT_TEST_NAVIGATE__(url) {
      navigateUrl = url;
    },
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
    body: new FakeElement({ text: bodyText }),
    querySelectorAll(selector) {
      if (selector.includes(',')) {
        return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
      }
      if (selector === '[data-qa="vacancy-serp__vacancy"]') return startOnResponseForm ? [] : [card];
      if (selector === '[data-qa="serp-item"]') return [];
      if (selector === '[data-qa*="vacancy-serp"]') return startOnResponseForm ? [] : [card];
      if (startOnResponseForm && selector === '[data-qa="vacancy-response-submit-popup"]') return [submitButton];
      if (startOnResponseForm && selector === '[data-qa="vacancy-response-letter-submit"]') return [submitButton];
      if (startOnResponseForm && selector === '[data-qa*="submit"]') return [submitButton];
      if (startOnResponseForm && selector === 'textarea') {
        return [hasQuestionField || hasTextarea ? textarea : null, hasCoverLetterField ? coverTextarea : null].filter(Boolean);
      }
      if (startOnResponseForm && selector === 'button') return [submitButton];
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
          return { dailyLimit: 1, delayMinMs: 1, delayMaxMs: 1, expectedSalary, ...localStore };
        },
        async set(value) {
          Object.assign(localStore, value);
        }
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${crypto.randomUUID()}`);
  assert.ok(listener, 'content script should register a listener');

  const response = await new Promise((resolve) => {
    const stayedAsync = listener({ type: 'START_AUTO_APPLY' }, {}, resolve);
    assert.equal(stayedAsync, true);
  });

  return {
    response,
    appended,
    states,
    submitClicks,
    followupClicks,
    textareaValue: textarea.value,
    coverTextareaValue: coverTextarea.value,
    localStore,
    navigateUrl
  };
}

async function runQueuedResponsePages({ count = 20, expectedSalary = '250 000 руб. на руки' } = {}) {
  const source = await readFile(new URL('src/content-hh.js', root), 'utf8');
  const appended = [];
  const states = [];
  const navigations = [];
  let submitClicks = 0;

  const items = Array.from({ length: count }, (_, index) => {
    const vacancyId = String(1000 + index);
    return {
      index: index + 1,
      vacancyId,
      title: `Vacancy ${index + 1}`,
      url: `https://hh.ru/vacancy/${vacancyId}`,
      responseUrl: `https://hh.ru/applicant/vacancy_response?vacancyId=${vacancyId}`,
      testDetected: true
    };
  });

  const localStore = {
    expectedSalary,
    autoApplyQueue: {
      active: true,
      runId: 'test-run',
      index: 0,
      items,
      counters: {
        found: count,
        processed: 0,
        applied: 0,
        skipped: 0,
        errors: 0
      },
      config: {
        delayMinMs: 1,
        delayMaxMs: 1
      }
    }
  };

  for (let pageIndex = 0; pageIndex < count; pageIndex += 1) {
    const textarea = new FakeElement({
      text: 'Писать тут',
      attrs: { name: `task_${pageIndex}_text` }
    });
    const submitButton = new FakeElement({
      text: 'Откликнуться',
      click() {
        submitClicks += 1;
      }
    });

    globalThis.location = {
      href: items[pageIndex].responseUrl,
      pathname: '/applicant/vacancy_response'
    };
    globalThis.window = {
      __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
      __HH_JOB_ASSISTANT_TEST_NAVIGATE__(url) {
        navigations.push(url);
      },
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
      title: 'HH queued response page',
      body: new FakeElement({ text: 'Отклик на вакансию Ответьте на вопросы Писать тут Откликнуться' }),
      querySelectorAll(selector) {
        if (selector.includes(',')) {
          return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
        }
        if (selector === '[data-qa="vacancy-serp__vacancy"]') return [];
        if (selector === '[data-qa="serp-item"]') return [];
        if (selector === '[data-qa*="vacancy-serp"]') return [];
        if (selector === '[data-qa="vacancy-response-submit-popup"]') return [submitButton];
        if (selector === '[data-qa="vacancy-response-letter-submit"]') return [submitButton];
        if (selector === '[data-qa*="submit"]') return [submitButton];
        if (selector === 'textarea') return [textarea];
        if (selector === 'button') return [submitButton];
        if (selector === '[role="dialog"]') return [];
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
          addListener() {}
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
            return Promise.resolve({ ok: false, error: 'Groq API key is not configured' });
          }
          return Promise.resolve({ ok: true });
        }
      },
      storage: {
        local: {
          async get() {
            return { dailyLimit: count, delayMinMs: 1, delayMaxMs: 1, expectedSalary, ...localStore };
          },
          async set(value) {
            Object.assign(localStore, value);
          }
        }
      }
    };

    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#queued-${pageIndex}-${crypto.randomUUID()}`);
    const started = Date.now();
    while (
      (textarea.value !== expectedSalary ||
        submitClicks < pageIndex + 1 ||
        localStore.autoApplyQueue.index < pageIndex + 1) &&
      Date.now() - started < 3000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(textarea.value, expectedSalary);
    assert.equal(submitClicks, pageIndex + 1);
    assert.equal(localStore.autoApplyQueue.index, pageIndex + 1);
  }

  return { appended, states, navigations, submitClicks, localStore };
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
  assert.match(result.appended.at(-1).error, /Groq API key is missing/);
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
  assert.match(result.appended.at(-1).error, /Groq API key is missing/);
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

test('auto apply confirms country warning follow-up modal', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: false,
    followupDialogText: [
      'Вы откликаетесь на вакансию в другой стране',
      'Если это не удалённая работа и вы не указали, что хотите переехать, скорее всего, будет отказ',
      'Все равно откликнуться',
      'Отменить'
    ].join('\n')
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.followupClicks, 1);
  assert.equal(result.appended.at(-1).status, 'applied');
});

test('auto apply fills required question on open response form', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    groqResponse: { ok: true, text: '250 000 руб. на руки' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, '250 000 руб. на руки');
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply uses expected salary for required question when Groq key is missing', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    expectedSalary: '250 000 руб. на руки'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, '250 000 руб. на руки');
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply fills question and mandatory cover letter without Groq key', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    hasCoverLetterField: true,
    expectedSalary: '250 000 руб. на руки'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, '250 000 руб. на руки');
  assert.match(result.coverTextareaValue, /Здравствуйте!/);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
  assert.equal(result.appended.at(-1).coverLetterUsed, true);
});

test('auto apply counts already confirmed response page as applied', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: false,
    startOnResponseForm: true,
    bodyText: 'Отклик на вакансию Вы откликнулись Чат'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.appended.at(-1).status, 'applied_already_confirmed');
});

test('auto apply queues hh response links across navigation', async () => {
  const responseHref = 'https://hh.ru/applicant/vacancy_response?vacancyId=123&hhtmFrom=vacancy_search_list';
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: false,
    responseHref
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.queued, true);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.navigateUrl, responseHref);
  assert.equal(result.localStore.autoApplyQueue.active, true);
  assert.equal(result.localStore.autoApplyQueue.items.length, 1);
  assert.equal(result.localStore.autoApplyQueue.items[0].responseUrl, responseHref);
});

test('auto apply continues queued response pages for 20 applications', async () => {
  const result = await runQueuedResponsePages({ count: 20 });

  assert.equal(result.submitClicks, 20);
  assert.equal(result.appended.length, 20);
  assert.equal(result.appended.every((item) => item.status === 'applied_test_assisted'), true);
  assert.equal(result.navigations.length, 19);
  assert.equal(result.localStore.autoApplyQueue.active, false);
  assert.equal(result.localStore.autoApplyQueue.index, 20);
  assert.equal(result.localStore.autoApplyQueue.counters.applied, 20);
  assert.equal(result.localStore.autoApplyQueue.counters.processed, 20);
  assert.equal(result.localStore.autoApplyQueue.counters.errors, 0);
  assert.equal(result.states.at(-1).state, 'complete');
  assert.equal(result.states.at(-1).applied, 20);
});
