#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const profileDir = resolve(process.env.HHJA_CHROMIUM_USER_DATA_DIR || '.hhja-chromium-profile');
const targetUrl = process.env.HH_TEST_URL || 'https://hh.ru/search/vacancy?text=java';
const timeoutMs = Number(process.env.HHJA_CHROMIUM_TIMEOUT_MS || 30000);
const keepOpen = process.env.HHJA_CHROMIUM_KEEP_OPEN === '1';
const browserPath = process.env.HHJA_CHROMIUM_PATH || await findBrowserPath();

function fail(message) {
  console.error(`Chromium hh live smoke failed: ${message}`);
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

function devToolsHttpOrigin(wsUrl) {
  const parsed = new URL(wsUrl);
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.href.replace(/\/$/, '');
}

function runSmoke(cdpUrl) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [join(scriptDir, 'hh-live-smoke.mjs')], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HH_CHROME_CDP_URL: cdpUrl,
        HH_TEST_URL: targetUrl
      },
      stdio: 'inherit'
    });
    child.once('exit', (code, signal) => resolveRun({ code, signal }));
  });
}

let browser = null;
let browserOutput = '';

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
    targetUrl
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  browser.stdout?.on('data', (chunk) => {
    browserOutput = `${browserOutput}${chunk.toString('utf8')}`.slice(-4000);
  });
  browser.stderr?.on('data', (chunk) => {
    browserOutput = `${browserOutput}${chunk.toString('utf8')}`.slice(-4000);
  });

  const devToolsUrl = await waitForDevToolsUrl(browser);
  const cdpUrl = devToolsHttpOrigin(devToolsUrl);
  const result = await runSmoke(cdpUrl);

  if (result.code !== 0) {
    throw new Error(
      `hh-live-smoke exited with code=${result.code} signal=${result.signal || 'none'}; ` +
      `profile=${profileDir}`
    );
  }
} catch (error) {
  const details = [
    error instanceof Error ? error.message : String(error),
    `Profile: ${profileDir}`,
    browserOutput.trim() ? `Browser output:\n${browserOutput.trim()}` : ''
  ].filter(Boolean).join('\n');
  fail(details);
} finally {
  if (browser && !browser.killed && !keepOpen) {
    browser.kill('SIGTERM');
  }
}
