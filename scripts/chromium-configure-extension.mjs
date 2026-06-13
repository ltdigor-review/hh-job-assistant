#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const manifest = JSON.parse(await readFile(join(repoRoot, 'manifest.json'), 'utf8'));
const profileDir = resolve(process.env.HHJA_CHROMIUM_USER_DATA_DIR || '.hhja-chromium-profile');
const timeoutMs = Number(process.env.HHJA_CHROMIUM_TIMEOUT_MS || 30000);
const envFile = process.env.HHJA_ENV_FILE || '';
const browserPath = process.env.HHJA_CHROMIUM_PATH || await findBrowserPath();

function fail(message) {
  console.error(`Chromium extension configure failed: ${message}`);
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
      // Try the next local browser.
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

function parseEnvText(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function loadConfiguredEnv() {
  if (!envFile) return {};
  return parseEnvText(await readFile(resolve(envFile), 'utf8'));
}

function pickConfig(fileEnv) {
  const read = (...names) => {
    for (const name of names) {
      const value = process.env[name] ?? fileEnv[name];
      if (String(value || '').trim()) return String(value).trim();
    }
    return '';
  };

  const patch = {};
  const groqApiKey = read('HHJA_GROQ_API_KEY', 'GROQ_API_KEY');
  const groqModel = read('HHJA_GROQ_MODEL', 'GROQ_MODEL');
  const resumeUrl = read('HHJA_RESUME_URL', 'RESUME_URL');
  const expectedSalary = read('HHJA_EXPECTED_SALARY', 'EXPECTED_SALARY');
  const dailyLimit = read('HHJA_DAILY_LIMIT');
  const delayMinMs = read('HHJA_DELAY_MIN_MS');
  const delayMaxMs = read('HHJA_DELAY_MAX_MS');
  const chatReplyMode = read('HHJA_CHAT_REPLY_MODE');
  const chatLimit = read('HHJA_CHAT_LIMIT');
  const chatUnreadOnly = read('HHJA_CHAT_UNREAD_ONLY');

  if (groqApiKey) patch.groqApiKey = groqApiKey;
  if (groqModel) patch.groqModel = groqModel;
  if (resumeUrl) patch.resumeUrl = resumeUrl;
  if (expectedSalary) patch.expectedSalary = expectedSalary;
  if (dailyLimit) patch.dailyLimit = Math.max(1, Math.min(Number(dailyLimit) || 20, 100));
  if (delayMinMs) patch.delayMinMs = Math.max(500, Number(delayMinMs) || 2500);
  if (delayMaxMs) patch.delayMaxMs = Math.max(500, Number(delayMaxMs) || 5000);
  if (chatReplyMode) patch.chatReplyMode = chatReplyMode === 'auto_send' ? 'auto_send' : 'draft';
  if (chatLimit) patch.chatLimit = Math.max(1, Math.min(Number(chatLimit) || 10, 100));
  if (chatUnreadOnly) patch.chatUnreadOnly = !/^(0|false|no)$/i.test(chatUnreadOnly);

  return patch;
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

async function evaluateTargetManifest(session, targetId) {
  const { sessionId } = await session.send('Target.attachToTarget', {
    targetId,
    flatten: true
  });

  try {
    const evaluation = await session.send('Runtime.evaluate', {
      expression: 'chrome.runtime.getManifest()',
      returnByValue: true
    }, { sessionId });
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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Expected extension worker/background was not discovered.');
}

async function setExtensionStorage(session, sessionId, patch) {
  const expression = `new Promise((resolve) => {
    const patch = ${JSON.stringify(patch)};
    chrome.storage.local.set(patch, () => {
      chrome.storage.local.get(Object.keys(patch), (value) => {
        resolve(Object.fromEntries(Object.entries(value).map(([key, item]) => [
          key,
          key === 'groqApiKey' ? Boolean(item) : item
        ])));
      });
    });
  })`;
  const evaluation = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, { sessionId });
  return evaluation.result?.value || {};
}

let browser = null;
let session = null;
try {
  const fileEnv = await loadConfiguredEnv();
  const patch = pickConfig(fileEnv);
  if (Object.keys(patch).length === 0) {
    fail('No config values provided. Set HHJA_ENV_FILE or HHJA_* environment variables.');
  }

  await mkdir(profileDir, { recursive: true });
  browser = spawn(browserPath, [
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${repoRoot}`,
    `--load-extension=${repoRoot}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-position=-32000,-32000',
    '--window-size=800,600',
    'https://hh.ru/?hhjaConfigureExtension=1'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const devToolsUrl = await waitForDevToolsUrl(browser);
  session = await createCdpSession(devToolsUrl);
  const extensionTarget = await waitForExtensionTarget(session);
  const stored = await setExtensionStorage(session, extensionTarget.sessionId, patch);

  console.log(JSON.stringify({
    ok: true,
    extensionVersion: extensionTarget.manifest.version,
    profileDir,
    envFile: envFile ? resolve(envFile) : '',
    configuredKeys: Object.keys(patch).sort(),
    storedEvidence: Object.fromEntries(Object.entries(stored).map(([key, value]) => [
      key,
      key === 'groqApiKey' ? Boolean(value) : value
    ]))
  }, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  session?.close();
  if (browser && !browser.killed) {
    browser.kill('SIGTERM');
  }
}
