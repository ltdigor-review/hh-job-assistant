import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { once } from 'node:events';
import { readContentScriptSource } from './helpers/content-script-source.mjs';
import { createSettingsUiHarness } from './helpers/settings-ui-harness.mjs';

const root = new URL('../', import.meta.url);

function chromePath() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path));
}

async function waitForJson(url, timeoutMs = 10000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`${response.status} ${await response.text()}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function waitForDevToolsPort(userDataDir, timeoutMs = 10000) {
  const activePortPath = join(userDataDir, 'DevToolsActivePort');
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const text = await readFile(activePortPath, 'utf8');
      const port = Number(text.split(/\r?\n/)[0]);
      if (Number.isFinite(port) && port > 0) return port;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`Timed out waiting for ${activePortPath}`);
}

async function cdpFetch(port, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response.json();
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome DevTools websocket')), {
      once: true
    });
  });
}

async function createCdpSession(wsUrl) {
  const socket = await connectWebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const rejectPending = (error) => {
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
  };

  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (!data.id || !pending.has(data.id)) return;
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) {
      reject(new Error(data.error.message || JSON.stringify(data.error)));
    } else {
      resolve(data.result);
    }
  });
  socket.addEventListener('close', () => rejectPending(new Error('Chrome DevTools websocket closed')));
  socket.addEventListener('error', () => rejectPending(new Error('Chrome DevTools websocket error')));

  return {
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    close() {
      socket.close();
    }
  };
}

async function waitForComplete(session, expectedUrl = '') {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const result = await session.send('Runtime.evaluate', {
      // A new CDP target can still expose the complete initial about:blank document.
      expression: `(!${JSON.stringify(expectedUrl)} || location.href === ${JSON.stringify(expectedUrl)}) && document.readyState === 'complete'`,
      returnByValue: true
    });
    if (result.result?.value === true) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Page load timed out');
}

function hhBlockedFixture() {
  return `<!doctype html>
    <html lang="ru">
      <head>
        <meta charset="utf-8">
        <title>HH fixture</title>
        <style>
          body { font-family: Arial, sans-serif; }
          [role="dialog"] {
            position: fixed;
            inset: 12% 18%;
            padding: 24px;
            background: white;
            border: 1px solid #ccd6e2;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,.25);
          }
          .close { float: right; }
        </style>
      </head>
      <body>
        <main>
          <article data-qa="vacancy-serp__vacancy">
            <a data-qa="serp-item__title" href="https://hh.ru/vacancy/123">Chief Product Officer/CPO Data</a>
            <button data-qa="vacancy-serp__vacancy_response">Откликнуться</button>
          </article>
          <a data-qa="pager-next" href="https://hh.ru/search/vacancy?text=java&page=1">дальше</a>
        </main>
        <script>
          document.querySelector('[data-qa="vacancy-serp__vacancy_response"]').addEventListener('click', () => {
            const dialog = document.createElement('section');
            dialog.setAttribute('role', 'dialog');
            dialog.innerHTML = \`
              <button class="close" aria-label="Закрыть">×</button>
              <h1>Отклик на вакансию</h1>
              <h2>Chief Product Officer/CPO Data</h2>
              <p>Чтобы откликнуться на эту вакансию, поменяйте видимость резюме на «Видно компаниям-клиентам HeadHunter»</p>
              <button data-qa="vacancy-response-submit-popup" disabled>Откликнуться</button>
            \`;
            dialog.querySelector('[aria-label="Закрыть"]').addEventListener('click', () => dialog.remove());
            document.body.append(dialog);
          });
        </script>
      </body>
    </html>`;
}

function hhDailyLimitFixture() {
  return `<!doctype html>
    <html lang="ru">
      <head>
        <meta charset="utf-8">
        <title>HH daily limit fixture</title>
        <style>
          body { font-family: Arial, sans-serif; }
          [role="status"] {
            position: fixed;
            top: 24px;
            right: 24px;
            max-width: 420px;
            padding: 16px;
            background: white;
            border: 1px solid #ccd6e2;
            box-shadow: 0 8px 24px rgba(0,0,0,.18);
          }
        </style>
      </head>
      <body>
        <main>
          <article data-qa="vacancy-serp__vacancy">
            <a data-qa="serp-item__title" href="https://hh.ru/vacancy/123">Chief Product Officer/CPO Data</a>
            <button data-qa="vacancy-serp__vacancy_response">Откликнуться</button>
          </article>
          <a data-qa="pager-next" href="https://hh.ru/search/vacancy?text=java&page=1">дальше</a>
        </main>
        <script>
          document.querySelector('[data-qa="vacancy-serp__vacancy_response"]').addEventListener('click', () => {
            const notice = document.createElement('div');
            notice.setAttribute('data-qa', 'vacancy-response-error-notification');
            notice.setAttribute('role', 'status');
            notice.innerHTML = \`
              <span>В течение 24 часов можно совершить не более 200 откликов. Вы исчерпали лимит откликов, попробуйте отправить отклик позднее.</span>
              <button data-qa="snackbar-close-action" aria-label="Закрыть"></button>
            \`;
            document.body.append(notice);
          });
        </script>
      </body>
    </html>`;
}

function buildInjection(contentScriptSource) {
  return `
    (async () => {
      window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__ = true;
      const messages = [];
      const storage = {};
      let listener = null;
      window.__HH_JOB_ASSISTANT_TEST_NAVIGATE__ = (url) => {
        window.__hhJobAssistantNavigatedTo = url;
      };
      window.chrome = {
        runtime: {
          onMessage: {
            addListener(fn) {
              listener = fn;
            }
          },
          sendMessage(message, callback) {
            messages.push(message);
            const response = message.type === 'GET_AUTOMATION_SETTINGS_AUDIT'
              ? { ok: true, audit: { ready: true, issues: [] } }
              : { ok: true };
            if (typeof callback === 'function') {
              queueMicrotask(() => callback(response));
            }
            return Promise.resolve(response);
          },
          getManifest() {
            return { version: 'test' };
          }
        },
        storage: {
          local: {
            get() {
              return Promise.resolve({
                dailyLimit: 2,
                delayMinMs: 1,
                delayMaxMs: 1,
                groqApiKey: 'gsk_test',
                resumeUrl: 'https://hh.ru/resume/test-resume',
                coverPrompt: 'cover prompt',
                employerQuestionPrompt: 'question prompt',
                choiceRetryPrompt: 'choice prompt',
                ...storage
              });
            },
            set(value) {
              Object.assign(storage, value);
              return Promise.resolve();
            }
          }
        }
      };
      ${contentScriptSource}
      if (!listener) throw new Error('Content script did not register listener');
      const response = await new Promise((resolve) => {
        const stayedAsync = listener({ type: 'START_AUTO_APPLY' }, {}, resolve);
        if (stayedAsync !== true) resolve({ ok: false, error: 'listener not async' });
      });
      return {
        response,
        messages,
        dialogCount: document.querySelectorAll('[role="dialog"]').length,
        navigatedTo: window.__hhJobAssistantNavigatedTo || '',
        bodyText: document.body.innerText
      };
    })()
  `;
}

test('real browser UI closes blocked hh response modal and continues', { timeout: 30000 }, async (t) => {
  const browser = chromePath();
  if (!browser) {
    t.skip('Chrome/Chromium not found');
    return;
  }

  const userDataDir = await mkdtemp(join(tmpdir(), 'hh-job-assistant-chrome-'));
  const chrome = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], {
    stdio: 'ignore'
  });

  let target;
  let session;
  let port = 0;
  try {
    port = await waitForDevToolsPort(userDataDir);
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    target = await cdpFetch(port, `/json/new?${encodeURIComponent(`data:text/html;charset=utf-8,${encodeURIComponent(hhBlockedFixture())}`)}`, {
      method: 'PUT'
    });
    session = await createCdpSession(target.webSocketDebuggerUrl);
    await session.send('Runtime.enable');
    await waitForComplete(session);

    const contentScriptSource = await readContentScriptSource();
    const evaluation = await session.send('Runtime.evaluate', {
      expression: buildInjection(contentScriptSource),
      awaitPromise: true,
      returnByValue: true,
      timeout: 15000
    });

    if (evaluation.exceptionDetails) {
      throw new Error(evaluation.exceptionDetails.text || 'Browser evaluation failed');
    }

    const value = evaluation.result.value;
    const states = value.messages.filter((message) => message.type === 'SET_RUN_STATE').map((message) => message.patch);
    const results = value.messages.filter((message) => message.type === 'APPEND_RUN_RESULT').map((message) => message.item);

    assert.equal(value.response.ok, true);
    assert.equal(value.response.skipped, 1);
    assert.equal(value.response.errors, 0);
    assert.equal(value.dialogCount, 0);
    assert.equal(value.navigatedTo, 'https://hh.ru/search/vacancy?text=java&page=1');
    assert.equal(results.at(-1).status, 'skipped_response_unavailable');
    assert.match(results.at(-1).error, /видимость резюме/);
    assert.ok(states.some((state) => state.currentAction === 'Переход на следующую страницу HH'));
  } finally {
    session?.close();
    if (port && target?.id) {
      await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
    }
    if (!chrome.killed) {
      chrome.kill('SIGTERM');
    }
    await Promise.race([
      once(chrome, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('real browser UI completes when hh daily response limit snackbar appears', { timeout: 30000 }, async (t) => {
  const browser = chromePath();
  if (!browser) {
    t.skip('Chrome/Chromium not found');
    return;
  }

  const userDataDir = await mkdtemp(join(tmpdir(), 'hh-job-assistant-chrome-'));
  const chrome = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], {
    stdio: 'ignore'
  });

  let target;
  let session;
  let port = 0;
  try {
    port = await waitForDevToolsPort(userDataDir);
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    target = await cdpFetch(port, `/json/new?${encodeURIComponent(`data:text/html;charset=utf-8,${encodeURIComponent(hhDailyLimitFixture())}`)}`, {
      method: 'PUT'
    });
    session = await createCdpSession(target.webSocketDebuggerUrl);
    await session.send('Runtime.enable');
    await waitForComplete(session);

    const contentScriptSource = await readContentScriptSource();
    const evaluation = await session.send('Runtime.evaluate', {
      expression: buildInjection(contentScriptSource),
      awaitPromise: true,
      returnByValue: true,
      timeout: 15000
    });

    if (evaluation.exceptionDetails) {
      throw new Error(evaluation.exceptionDetails.text || 'Browser evaluation failed');
    }

    const value = evaluation.result.value;
    const states = value.messages.filter((message) => message.type === 'SET_RUN_STATE').map((message) => message.patch);
    const results = value.messages.filter((message) => message.type === 'APPEND_RUN_RESULT').map((message) => message.item);

    assert.equal(value.response.ok, true);
    assert.equal(value.response.skipped, 1);
    assert.equal(value.response.errors, 0);
    assert.equal(value.navigatedTo, '');
    assert.match(value.bodyText, /не более 200 откликов/);
    assert.equal(results.at(-1).status, 'skipped_hh_daily_response_limit');
    assert.equal(states.at(-1).state, 'complete');
    assert.equal(states.at(-1).currentAction, 'Исчерпан лимит в 200 откликов в день');
    assert.equal(states.at(-1).lastError, '');
  } finally {
    session?.close();
    if (port && target?.id) {
      await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
    }
    if (!chrome.killed) {
      chrome.kill('SIGTERM');
    }
    await Promise.race([
      once(chrome, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('[BS:COVERS:HHJA-BR-000045] real browser popup and Settings share AI mode without losing drafts or run history', { timeout: 30000 }, async (t) => {
  const browser = chromePath();
  if (!browser) { t.skip('Chrome/Chromium not found'); return; }
  const harness = await createSettingsUiHarness();
  const userDataDir = await mkdtemp(join(tmpdir(), 'hhja-settings-ui-'));
  const chrome = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, 'about:blank'], { stdio: 'ignore' });
  let session;
  try {
    const port = await waitForDevToolsPort(userDataDir);
    const target = await cdpFetch(port, `/json/new?${encodeURIComponent(harness.url)}`, { method: 'PUT' });
    session = await createCdpSession(target.webSocketDebuggerUrl);
    await session.send('Runtime.enable');
    await waitForComplete(session, new URL(harness.url).href);
    const evaluation = await session.send('Runtime.evaluate', {
      expression: `(async () => {
        const poll = async (predicate, description) => {
          for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 30)); }
          throw new Error('UI wait failed: ' + description);
        };
        const p = document.getElementById('popup').contentWindow;
        const o = document.getElementById('options').contentWindow;
        const pn = id => p.document.getElementById(id);
        const on = id => o.document.getElementById(id);
        await poll(() => pn('aiEnabled')?.checked && on('aiEnabled')?.checked && !pn('continueApply')?.disabled, 'initial saved queue');
        const initial = { popupTitle: p.document.title, optionsTitle: o.document.title, popupText: p.document.body.innerText.length, optionsText: o.document.body.innerText.length };
        on('fallbackCoverLetterTemplate').value = 'Несохранённое письмо: мой опыт.';
        on('coverPrompt').value = 'Несохранённый промпт';
        on('aiProviderApiKey').value = 'unsaved-synthetic-key';
        on('aiProviderApiKey').dispatchEvent(new Event('input', { bubbles: true }));
        pn('aiEnabled').click();
        await poll(() => !on('aiEnabled').checked && !pn('aiEnabled').checked && !pn('aiEnabled').disabled, 'popup -> Settings mode');
        const off = {
          mode: __uiStore.aiEnabled, queue: __uiStore.hasSavedQueue, history: __uiStore.runResults,
          continueDisabled: pn('continueApply').disabled,
          templateDraft: on('fallbackCoverLetterTemplate').value, promptDraft: on('coverPrompt').value,
          keyDraft: on('aiProviderApiKey').value, providerDisabled: on('aiProvider').disabled,
          profileDisabled: on('buildResumeProfile').disabled && on('editResumeProfile').disabled,
          templateEditable: !on('fallbackCoverLetterTemplate').disabled && !on('fallbackCoverLetterTemplate').readOnly
        };
        on('aiEnabled').click();
        await poll(() => pn('aiEnabled').checked && !on('aiEnabled').disabled, 'Settings -> popup mode');
        const onAgain = { mode: __uiStore.aiEnabled, template: on('fallbackCoverLetterTemplate').value, prompt: on('coverPrompt').value };
        await p.chrome.storage.local.set({ runState: { state: 'applying' }, autoApplyRunLease: { active: true } });
        await poll(() => pn('aiEnabled').disabled && on('aiEnabled').disabled, 'active run lock');
        pn('aiEnabled').click(); on('aiEnabled').click();
        const locked = { mode: __uiStore.aiEnabled, bothDisabled: pn('aiEnabled').disabled && on('aiEnabled').disabled };
        await p.chrome.storage.local.set({ runState: { state: 'stopped' }, autoApplyRunLease: { active: false } });
        await poll(() => !pn('aiEnabled').disabled && !on('aiEnabled').disabled, 'unlock');
        on('aiEnabled').click();
        await poll(() => !__uiStore.aiEnabled && !on('aiEnabled').disabled, 'disable before keyless run');
        await p.chrome.storage.local.set({ aiProviderCredentials: {}, groqApiKey: '', resumeProfileText: '' });
        await poll(() => !pn('autoApply').disabled, 'no AI start readiness');
        const keyless = { startEnabled: !pn('autoApply').disabled, profileText: __uiStore.resumeProfileText, apiKeys: __uiStore.aiProviderCredentials };
        on('save').click();
        await poll(() => on('status').textContent === 'Сохранено.', 'save fixed template');
        return { initial, off, onAgain, locked, keyless, savedTemplate: __uiStore.fallbackCoverLetterTemplate,
          modeAfterSave: __uiStore.aiEnabled, runtimeTypes: __uiMessages.map(m => m.type), errors: __uiErrors,
          overlays: [...p.document.querySelectorAll('vite-error-overlay, nextjs-portal'), ...o.document.querySelectorAll('vite-error-overlay, nextjs-portal')].length };
      })()`, awaitPromise: true, returnByValue: true, timeout: 18000
    });
    if (evaluation.exceptionDetails) throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text);
    const result = evaluation.result.value;
    assert.equal(result.initial.popupTitle, 'HH Job Assistant');
    assert.match(result.initial.optionsTitle, /HH Job Assistant/);
    assert.ok(result.initial.popupText > 100 && result.initial.optionsText > 100);
    assert.equal(result.off.mode, false);
    assert.equal(result.off.queue, false);
    assert.equal(result.off.continueDisabled, true);
    assert.equal(result.off.history[0].title, 'История сохранена');
    assert.equal(result.off.templateDraft, 'Несохранённое письмо: мой опыт.');
    assert.equal(result.off.promptDraft, 'Несохранённый промпт');
    assert.equal(result.off.keyDraft, 'unsaved-synthetic-key');
    assert.equal(result.off.providerDisabled, true);
    assert.equal(result.off.profileDisabled, true);
    assert.equal(result.off.templateEditable, true);
    assert.equal(result.onAgain.mode, true);
    assert.equal(result.onAgain.template, result.off.templateDraft);
    assert.equal(result.onAgain.prompt, result.off.promptDraft);
    assert.deepEqual(result.locked, { mode: true, bothDisabled: true });
    assert.equal(result.keyless.startEnabled, true);
    assert.deepEqual(result.keyless.apiKeys, {});
    assert.equal(result.keyless.profileText, '');
    assert.equal(result.savedTemplate, result.off.templateDraft);
    assert.equal(result.modeAfterSave, false);
    assert.ok(!result.runtimeTypes.some(type => /GENERATE|BUILD_RESUME|EDIT_RESUME|TEST_AI/.test(type)));
    assert.deepEqual(result.errors, []);
    assert.equal(result.overlays, 0);
  } finally {
    session?.close();
    chrome.kill('SIGTERM');
    await Promise.race([once(chrome, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
    await rm(userDataDir, { recursive: true, force: true });
    await harness.close();
  }
});
