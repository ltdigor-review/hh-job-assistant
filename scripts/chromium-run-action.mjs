#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const manifest = JSON.parse(await readFile(join(repoRoot, 'manifest.json'), 'utf8'));
const profileDir = resolve(process.env.HHJA_CHROMIUM_USER_DATA_DIR || '.hhja-chromium-profile');
const action = process.env.HHJA_ACTION || process.argv[2] || '';
const outputPath = process.env.HHJA_OUTPUT || '';
const timeoutMs = Number(process.env.HHJA_CHROMIUM_TIMEOUT_MS || 30000);
const actionTimeoutMs = Number(process.env.HHJA_ACTION_TIMEOUT_MS || 120000);
const startUrl = process.env.HH_TEST_URL || (action === 'START_CHAT_ASSIST' ? 'https://hh.ru/chat' : 'https://hh.ru/');
const browserPath = process.env.HHJA_CHROMIUM_PATH || await findBrowserPath();

function fail(message) {
  console.error(`Chromium action runner failed: ${message}`);
  process.exit(1);
}

async function findBrowserPath() {
  const candidates = [
    ...await findPlaywrightChromeForTestingPaths(),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  for (const candidate of candidates) {
    try {
      await import('node:fs/promises').then(({ access }) => access(candidate, constants.X_OK));
      return candidate;
    } catch {
      // Try next local browser.
    }
  }
  throw new Error('No Chromium-compatible browser found. Set HHJA_CHROMIUM_PATH.');
}

async function findPlaywrightChromeForTestingPaths() {
  const cacheDir = join(homedir(), 'Library/Caches/ms-playwright');
  try {
    const entries = await readdir(cacheDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium-'))
      .sort((a, b) => b.name.localeCompare(a.name))
      .map((entry) =>
        join(
          cacheDir,
          entry.name,
          'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
        )
      );
  } catch {
    return [];
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect to DevTools websocket')), {
      once: true
    });
  });
}

async function createCdpSession(wsUrl) {
  const socket = await connectWebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (!data.id || !pending.has(data.id)) return;
    const { resolve: resolvePending, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) {
      reject(new Error(data.error.message || JSON.stringify(data.error)));
    } else {
      resolvePending(data.result);
    }
  });

  return {
    send(method, params = {}, options = {}) {
      const id = nextId;
      nextId += 1;
      socket.send(JSON.stringify({ id, method, params, sessionId: options.sessionId }));
      return new Promise((resolvePending, reject) => {
        pending.set(id, { resolve: resolvePending, reject });
      });
    },
    close() {
      socket.close();
    }
  };
}

function waitForDevToolsUrl(child) {
  return new Promise((resolveDevTools, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for DevTools websocket after ${timeoutMs}ms`));
    }, timeoutMs);
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolveDevTools(match[1]);
    };
    child.stderr?.on('data', onData);
    child.stdout?.on('data', onData);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Browser exited before DevTools was ready: code=${code} signal=${signal}`));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function attachToTarget(session, targetId) {
  const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
  return sessionId;
}

async function evaluate(session, sessionId, expression, timeout = timeoutMs) {
  return Promise.race([
    session.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    }, { sessionId }),
    delay(timeout).then(() => {
      throw new Error(`Runtime.evaluate timed out after ${timeout}ms`);
    })
  ]);
}

async function waitForPageTarget(session) {
  const started = Date.now();
  const expected = new URL(startUrl);
  while (Date.now() - started < timeoutMs) {
    const { targetInfos = [] } = await session.send('Target.getTargets');
    const hhPages = targetInfos.filter((target) => target.type === 'page' && target.url.startsWith('https://hh.ru/'));
    const page = hhPages.find((target) => {
      try {
        const url = new URL(target.url);
        return url.pathname === expected.pathname;
      } catch {
        return false;
      }
    }) || hhPages[0];
    if (page) return page;
    await delay(250);
  }
  throw new Error('Expected hh.ru page target was not discovered.');
}

async function evaluateTargetManifest(session, targetId) {
  const sessionId = await attachToTarget(session, targetId);
  try {
    const evaluation = await evaluate(session, sessionId, 'chrome.runtime.getManifest()');
    return { sessionId, manifest: evaluation.result?.value || null };
  } catch (error) {
    await session.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    throw error;
  }
}

async function waitForExtensionTarget(session) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { targetInfos = [] } = await session.send('Target.getTargets');
    const extensionTargets = targetInfos.filter((target) =>
      ['service_worker', 'background_page'].includes(target.type) &&
      target.url.startsWith('chrome-extension://')
    );
    for (const extensionTarget of extensionTargets) {
      const inspected = await evaluateTargetManifest(session, extensionTarget.targetId);
      if (inspected.manifest?.name === manifest.name && inspected.manifest?.version === manifest.version) {
        return { ...extensionTarget, sessionId: inspected.sessionId, manifest: inspected.manifest };
      }
      await session.send('Target.detachFromTarget', { sessionId: inspected.sessionId }).catch(() => {});
    }
    await delay(250);
  }
  throw new Error('Expected extension worker/background was not discovered.');
}

async function discoverResumeUrl(session, pageSessionId) {
  await delay(3000);
  const expression = `(() => {
    if (/\\/resume\\//.test(location.pathname)) return location.href;
    const links = [...document.querySelectorAll('a[href*="/resume/"],a[href*="resume_hash"],a[href*="resume="]')]
      .map((link) => new URL(link.href, location.href).href)
      .filter((href) => /^https:\\/\\/([^/]+\\.)?hh\\.ru\\//.test(href));
    return links.find((href) => new URL(href).pathname.match(/^\\/resume\\/[^/?#]+/)) || '';
  })()`;
  const evaluation = await evaluate(session, pageSessionId, expression);
  return evaluation.result?.value || '';
}

async function maybeSetResumeUrl(session, extensionSessionId, pageSessionId) {
  const current = await evaluate(session, extensionSessionId, `new Promise((resolve) => {
    chrome.storage.local.get(['resumeUrl'], (value) => resolve(value.resumeUrl || ''));
  })`);
  if (/^https:\/\/([^/]+\.)?hh\.ru\/resume\/[^/?#]+/.test(current.result?.value || '')) {
    return current.result.value;
  }
  const discovered = await discoverResumeUrl(session, pageSessionId);
  if (!discovered) return '';
  await evaluate(session, extensionSessionId, `new Promise((resolve) => {
    chrome.storage.local.set({ resumeUrl: ${JSON.stringify(discovered)} }, () => resolve(true));
  })`);
  return discovered;
}

async function sendRuntimeAction(session, sessionId, messageType) {
  const expression = `new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: ${JSON.stringify(messageType)} }, (response) => {
      resolve(response || { ok: false, error: chrome.runtime.lastError?.message || 'No response' });
    });
  })`;
  const evaluation = await evaluate(session, sessionId, expression, actionTimeoutMs);
  return evaluation.result?.value || null;
}

async function waitForActiveContentScript(session, sessionId) {
  const started = Date.now();
  const expression = `new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) {
        resolve({ ok: false, error: 'No active tab' });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTENT_STATUS' }, (response) => {
        resolve(response || { ok: false, error: chrome.runtime.lastError?.message || 'No content response' });
      });
    });
  })`;
  while (Date.now() - started < timeoutMs) {
    const evaluation = await evaluate(session, sessionId, expression, timeoutMs).catch((error) => ({
      result: { value: { ok: false, error: error.message } }
    }));
    if (evaluation.result?.value?.ok) return evaluation.result.value;
    await delay(500);
  }
  throw new Error('Content script was not ready in the active hh.ru tab.');
}

async function createExtensionPageSession(session, extensionTargetUrl) {
  const extensionId = extensionTargetUrl.match(/^chrome-extension:\/\/([^/]+)/)?.[1] || '';
  if (!extensionId) {
    throw new Error(`Could not parse extension id from ${extensionTargetUrl}`);
  }
  const { targetId } = await session.send('Target.createTarget', {
    url: `chrome-extension://${extensionId}/src/popup.html`
  });
  const pageSessionId = await attachToTarget(session, targetId);
  await delay(500);
  return { targetId, sessionId: pageSessionId };
}

async function readEvidence(session, sessionId) {
  const expression = `new Promise((resolve) => {
    chrome.storage.local.get(['runState', 'runResults', 'chatReports', 'resumeUrl'], (value) => {
      resolve({
        runState: value.runState || null,
        runResults: Array.isArray(value.runResults) ? value.runResults.slice(-20) : [],
        chatReports: Array.isArray(value.chatReports) ? value.chatReports.slice(-20) : [],
        resumeUrlPresent: Boolean(value.resumeUrl)
      });
    });
  })`;
  const evaluation = await evaluate(session, sessionId, expression);
  const value = evaluation.result?.value || {};
  return {
    runState: value.runState || null,
    runResults: value.runResults || [],
    chatReports: (value.chatReports || []).map((item) => ({
      chatUrl: item.chatUrl || '',
      status: item.status || '',
      reason: item.reason || '',
      sent: Boolean(item.sent),
      hasDraftAnswer: Boolean(item.draftAnswer),
      error: item.error || ''
    })),
    resumeUrlPresent: Boolean(value.resumeUrlPresent)
  };
}

function waitForExit(child, timeout = 5000) {
  if (!child || child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise((resolveWait) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolveWait();
    }, timeout);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveWait();
    });
  });
}

async function closeBrowser(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  child.kill('SIGTERM');
  await waitForExit(child);
}

if (!['REFRESH_RESUMES_NOW', 'START_CHAT_ASSIST', 'TEST_GROQ'].includes(action)) {
  fail('Set HHJA_ACTION to REFRESH_RESUMES_NOW, START_CHAT_ASSIST, or TEST_GROQ.');
}

let browser = null;
let session = null;
try {
  await mkdir(profileDir, { recursive: true });
  browser = spawn(browserPath, [
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${repoRoot}`,
    `--load-extension=${repoRoot}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    startUrl
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const devToolsUrl = await waitForDevToolsUrl(browser);
  session = await createCdpSession(devToolsUrl);
  const pageTarget = await waitForPageTarget(session);
  const pageSessionId = await attachToTarget(session, pageTarget.targetId);
  const extensionTarget = await waitForExtensionTarget(session);
  const extensionPage = await createExtensionPageSession(session, extensionTarget.url);
  await session.send('Target.activateTarget', { targetId: pageTarget.targetId }).catch(() => {});
  if (action === 'START_CHAT_ASSIST') {
    await waitForActiveContentScript(session, extensionPage.sessionId);
  }

  let resumeUrl = '';
  if (action === 'REFRESH_RESUMES_NOW') {
    resumeUrl = await maybeSetResumeUrl(session, extensionTarget.sessionId, pageSessionId);
  }

  const response = await sendRuntimeAction(session, extensionPage.sessionId, action);
  const evidence = await readEvidence(session, extensionTarget.sessionId);
  const report = {
    ok: Boolean(response?.ok),
    generatedAt: new Date().toISOString(),
    action,
    extensionVersion: extensionTarget.manifest.version,
    profileDir,
    startUrl,
    response,
    resumeUrlPresent: Boolean(resumeUrl || evidence.resumeUrlPresent),
    evidence
  };
  if (outputPath) {
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  session?.close();
  await closeBrowser(browser);
}

process.exit(0);
