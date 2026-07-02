#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const manifest = JSON.parse(await readFile(join(repoRoot, 'manifest.json'), 'utf8'));
const profileDir = resolve(process.env.HHJA_CHROMIUM_USER_DATA_DIR || '.hhja-chromium-profile');
const defaultUrl = 'https://hh.ru/search/vacancy?text=java';
const requestedUrl = process.argv[2] || process.env.HH_TEST_URL || defaultUrl;
const runMs = Number(process.env.HHJA_CHROMIUM_RUN_MS || 60000);
const keepOpen = process.env.HHJA_CHROMIUM_KEEP_OPEN === '1';
const timeoutMs = Number(process.env.HHJA_CHROMIUM_TIMEOUT_MS || 30000);
const outputPath = process.env.HHJA_OUTPUT || '';
const browserPath = process.env.HHJA_CHROMIUM_PATH || await findBrowserPath();
const autoStartToken = randomUUID();

function fail(message) {
  console.error(`Chromium auto-apply launcher failed: ${message}`);
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

function buildAutoStartUrl(value, token) {
  const parsed = new URL(value);
  if (parsed.hostname !== 'hh.ru' && !parsed.hostname.endsWith('.hh.ru')) {
    throw new Error('URL must be on hh.ru');
  }
  if (parsed.pathname !== '/search/vacancy' && parsed.pathname !== '/applicant/vacancy_response') {
    throw new Error('URL must be an hh.ru vacancy search or response form page');
  }

  parsed.searchParams.set('hhjaAutoStart', 'live');
  parsed.searchParams.set('hhjaAutoStartToken', token);
  const limit = Math.max(1, Math.min(Number(process.env.HHJA_LIMIT || 1) || 1, 100));
  parsed.searchParams.set('hhjaLimit', String(limit));
  if (process.env.HHJA_MAX_PROCESSED) {
    const maxProcessed = Math.max(1, Math.min(Number(process.env.HHJA_MAX_PROCESSED) || 1, 1000));
    parsed.searchParams.set('hhjaMaxProcessed', String(maxProcessed));
  }
  if (process.env.HHJA_GROQ_MODEL) {
    parsed.searchParams.set('hhjaGroqModel', process.env.HHJA_GROQ_MODEL);
  }
  return parsed.href;
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
  const rejectPending = (error) => {
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
  };

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
  socket.addEventListener('close', () => rejectPending(new Error('Chrome DevTools websocket closed')));
  socket.addEventListener('error', () => rejectPending(new Error('Chrome DevTools websocket error')));

  return {
    send(method, params = {}, options = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolvePending, reject) => {
        pending.set(id, { resolve: resolvePending, reject });
        try {
          socket.send(JSON.stringify({ id, method, params, sessionId: options.sessionId }));
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
  let lastUrls = [];

  while (Date.now() - started < timeoutMs) {
    const { targetInfos = [] } = await session.send('Target.getTargets');
    lastUrls = targetInfos.map((target) => `${target.type}:${target.url}`).filter(Boolean);
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

  throw new Error(`Expected extension worker/background was not discovered. Targets: ${lastUrls.join(', ') || 'none'}`);
}

function summarizeResult(item = {}) {
  return {
    status: item.status || '',
    title: item.title || '',
    vacancyId: item.vacancyId || '',
    url: item.url || item.responseUrl || '',
    error: item.error || '',
    coverLetterUsed: Boolean(item.coverLetterUsed),
    testDetected: Boolean(item.testDetected)
  };
}

async function readExtensionEvidence(session, sessionId) {
  const expression = `new Promise((resolve) => {
    chrome.storage.local.get(['runState', 'runResults'], (value) => {
      const runResults = Array.isArray(value.runResults) ? value.runResults : [];
      resolve({
        runState: value.runState || null,
        runResults: runResults.slice(-20)
      });
    });
  })`;
  const evaluation = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, { sessionId });
  const value = evaluation.result?.value || {};
  const runResults = Array.isArray(value.runResults) ? value.runResults.map(summarizeResult) : [];
  return {
    runState: value.runState || null,
    counts: {
      applied: runResults.filter((item) => /^applied/.test(item.status)).length,
      skipped: runResults.filter((item) => /^skipped/.test(item.status)).length,
      results: runResults.length
    },
    runResults
  };
}

async function setAutoStartToken(session, sessionId, token) {
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const expression = `new Promise((resolve) => {
    chrome.storage.local.set({
      autoApplyAutoStartToken: ${JSON.stringify(token)},
      autoApplyAutoStartTokenExpiresAt: ${JSON.stringify(expiresAt)}
    }, () => resolve(true));
  })`;
  await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, { sessionId });
}

function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode != null || child.signalCode != null) {
    return Promise.resolve();
  }
  return new Promise((resolveWait) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolveWait();
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolveWait();
    });
  });
}

async function closeBrowser(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  child.kill('SIGTERM');
  await waitForExit(child);
}

try {
  await mkdir(profileDir, { recursive: true });
  const autoStartUrl = buildAutoStartUrl(requestedUrl, autoStartToken);
  const browser = spawn(browserPath, [
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${repoRoot}`,
    `--load-extension=${repoRoot}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    'about:blank'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  let stdout = '';
  const cleanup = () => {
    if (browser.exitCode == null && browser.signalCode == null) {
      browser.kill('SIGTERM');
    }
  };
  process.once('exit', cleanup);
  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
  browser.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000);
  });
  browser.stdout?.on('data', (chunk) => {
    stdout = `${stdout}${chunk.toString('utf8')}`.slice(-4000);
  });
  const devToolsUrl = await waitForDevToolsUrl(browser);
  const session = await createCdpSession(devToolsUrl);
  const extensionTarget = await waitForExtensionTarget(session);
  await setAutoStartToken(session, extensionTarget.sessionId, autoStartToken);
  await session.send('Target.createTarget', { url: autoStartUrl });

  console.log(JSON.stringify({
    ok: true,
    browserPath,
    extensionVersion: extensionTarget.manifest.version,
    profileDir,
    runMs: keepOpen ? null : runMs,
    url: autoStartUrl
  }, null, 2));

  if (!keepOpen) {
    await delay(runMs);
    const evidence = await readExtensionEvidence(session, extensionTarget.sessionId);
    const report = {
      ok: true,
      generatedAt: new Date().toISOString(),
      extensionVersion: extensionTarget.manifest.version,
      profileDir,
      url: autoStartUrl,
      ...evidence
    };
    if (outputPath) {
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(report, null, 2));
    session.close();
    await closeBrowser(browser);
    const browserOutput = `${stdout}\n${stderr}`.trim();
    if (browserOutput) {
      console.error(browserOutput);
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
