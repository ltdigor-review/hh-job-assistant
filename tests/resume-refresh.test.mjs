import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { FakeElement } from './helpers/fake-element.mjs';

const root = new URL('../', import.meta.url);

async function runBackgroundResumeRefresh({
  resumeUrl = 'https://ekaterinburg.hh.ru/resume/abc123',
  activeUrl = 'https://hh.ru/search/vacancy?text=java',
  bodyText = 'Java Developer resume',
  hasEdit = true,
  hasSave = true,
  hasRaise = true,
  tabStatus = 'complete'
} = {}) {
  let listener = null;
  const localData = { resumeUrl };
  const updatedUrls = [];
  let page = 'search';
  let editClicks = 0;
  let saveClicks = 0;
  let raiseClicks = 0;
  const activeTab = { id: 7, url: activeUrl, status: tabStatus };
  globalThis.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__ = true;

  globalThis.window = {
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    },
    scrollX: 0,
    scrollY: 0,
    __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true
  };
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;

  function createDocument({ pathname, text, buttons }) {
    const elementsById = new Map();
    const body = new FakeElement({ text });
    body.append = (...children) => {
      body.children.push(...children);
      for (const child of children) {
        if (child.id) elementsById.set(child.id, child);
      }
    };

    globalThis.document = {
      readyState: 'interactive',
      title: 'Java Developer',
      body,
      createElement() {
        const element = new FakeElement();
        Object.defineProperty(element, 'id', {
          get() {
            return this.attrs.id || '';
          },
          set(value) {
            this.attrs.id = String(value);
            elementsById.set(String(value), this);
          }
        });
        return element;
      },
      getElementById(id) {
        return elementsById.get(id) || null;
      },
      querySelectorAll(selector) {
        if (selector.includes(',')) {
          return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
        }
        if (selector === '[data-hh-job-assistant-highlight]') return buttons.filter((button) => button.attrs['data-hh-job-assistant-highlight']);
        if (selector === 'button' || selector === 'a' || selector === '[role="button"]' || selector === 'input[type="submit"]') {
          return buttons;
        }
        return [];
      }
    };
    globalThis.location = { pathname };
  }

  function setPage(nextPage) {
    page = nextPage;
    if (page === 'resume') {
      const buttons = [];
      if (hasEdit) {
        buttons.push(new FakeElement({ text: 'Редактировать', click() { editClicks += 1; setPage('edit'); } }));
      }
      if (hasRaise) {
        buttons.push(new FakeElement({ text: 'Поднять в поиске', click() { raiseClicks += 1; } }));
      }
      createDocument({ pathname: '/resume/abc123', text: bodyText, buttons });
      return;
    }

    if (page === 'edit') {
      const buttons = hasSave
        ? [new FakeElement({ text: 'Сохранить', click() { saveClicks += 1; setPage('resumeAfterSave'); } })]
        : [];
      createDocument({ pathname: '/resume/abc123/edit', text: 'Редактирование резюме', buttons });
      return;
    }

    if (page === 'resumeAfterSave') {
      const buttons = hasRaise ? [new FakeElement({ text: 'Поднять в поиске', click() { raiseClicks += 1; } })] : [];
      createDocument({ pathname: '/resume/abc123', text: 'Резюме сохранено', buttons });
      return;
    }

    createDocument({ pathname: '/search/vacancy', text: 'HH вакансии', buttons: [] });
  }

  setPage('search');

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
      async query() {
        return [activeTab];
      },
      async update(id, patch) {
        assert.equal(id, activeTab.id);
        if (patch.url) {
          activeTab.url = patch.url;
          updatedUrls.push(patch.url);
          setPage('resume');
        }
        return activeTab;
      },
      async get() {
        return { status: activeTab.status, url: activeTab.url };
      },
      async create() {
        throw new Error('tabs.create should not be used for resume refresh');
      },
      async remove() {
        throw new Error('tabs.remove should not be used for resume refresh');
      },
      onUpdated: {
        addListener() {},
        removeListener() {}
      }
    },
    scripting: {
      async executeScript({ func, args = [] }) {
        return [{ result: await func(...args) }];
      }
    }
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);

  const response = await new Promise((resolve) => {
    const stayedAsync = listener({ type: 'REFRESH_RESUMES_NOW' }, {}, resolve);
    assert.equal(stayedAsync, true);
  });

  return { response, localData, updatedUrls, editClicks, saveClicks, raiseClicks };
}

test('resume refresh continues when Chrome tab status stays loading after DOM is ready', async () => {
  const { response, editClicks, saveClicks, raiseClicks, updatedUrls } = await runBackgroundResumeRefresh({ tabStatus: 'loading' });

  assert.equal(response.ok, true);
  assert.equal(editClicks, 1);
  assert.equal(saveClicks, 1);
  assert.equal(raiseClicks, 1);
  assert.deepEqual(updatedUrls, ['https://ekaterinburg.hh.ru/resume/abc123']);
});

test('resume refresh uses configured resume URL in the active hh tab and edits before raising', async () => {
  const { response, localData, updatedUrls, editClicks, saveClicks, raiseClicks } = await runBackgroundResumeRefresh();

  assert.equal(response.ok, true);
  assert.equal(editClicks, 1);
  assert.equal(saveClicks, 1);
  assert.equal(raiseClicks, 1);
  assert.deepEqual(updatedUrls, ['https://ekaterinburg.hh.ru/resume/abc123']);
  assert.equal(localData.runState.state, 'idle');
  assert.equal(localData.runState.currentAction, 'Готово');
});

test('resume refresh succeeds after save when raise is not available', async () => {
  const { response, editClicks, saveClicks, raiseClicks, localData } = await runBackgroundResumeRefresh({ hasRaise: false });

  assert.equal(response.ok, true);
  assert.equal(response.raiseSkipped, true);
  assert.equal(editClicks, 1);
  assert.equal(saveClicks, 1);
  assert.equal(raiseClicks, 0);
  assert.equal(localData.runResults.at(-1).status, 'resume_refresh_saved');
});

test('resume refresh fails before navigation when active tab is not hh', async () => {
  const { response, updatedUrls, editClicks } = await runBackgroundResumeRefresh({ activeUrl: 'https://example.com/' });

  assert.equal(response.ok, false);
  assert.equal(response.error, 'Откройте вкладку hh.ru и повторите');
  assert.deepEqual(updatedUrls, []);
  assert.equal(editClicks, 0);
});

test('resume refresh fails before navigation when configured resume URL is missing', async () => {
  const { response, updatedUrls, editClicks } = await runBackgroundResumeRefresh({ resumeUrl: '' });

  assert.equal(response.ok, false);
  assert.equal(response.error, 'Укажите Resume URL в настройках');
  assert.deepEqual(updatedUrls, []);
  assert.equal(editClicks, 0);
});

test('resume refresh stops on login or captcha page', async () => {
  const { response, localData, editClicks, saveClicks, raiseClicks } = await runBackgroundResumeRefresh({
    bodyText: 'Подтвердите, что вы не робот'
  });

  assert.equal(response.ok, false);
  assert.equal(response.error, 'Login or captcha page detected');
  assert.equal(editClicks, 0);
  assert.equal(saveClicks, 0);
  assert.equal(raiseClicks, 0);
  assert.equal(localData.runState.state, 'error');
  assert.equal(localData.runState.lastError, 'Login or captcha page detected');
});

test('resume refresh fails when edit button is missing', async () => {
  const { response, editClicks, saveClicks, raiseClicks } = await runBackgroundResumeRefresh({ hasEdit: false });

  assert.equal(response.ok, false);
  assert.equal(response.error, 'Edit button not found');
  assert.equal(editClicks, 0);
  assert.equal(saveClicks, 0);
  assert.equal(raiseClicks, 0);
});

test('resume refresh fails when save button is missing', async () => {
  const { response, editClicks, saveClicks, raiseClicks } = await runBackgroundResumeRefresh({ hasSave: false });

  assert.equal(response.ok, false);
  assert.equal(response.error, 'Save button not found');
  assert.equal(editClicks, 1);
  assert.equal(saveClicks, 0);
  assert.equal(raiseClicks, 0);
});
