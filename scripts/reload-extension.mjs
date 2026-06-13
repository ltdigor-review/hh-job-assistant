#!/usr/bin/env node

import { spawn } from 'node:child_process';

const DEFAULT_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_PROFILE = 'Profile 1';
const DEFAULT_RELOAD_URL = 'https://hh.ru/?hhjaReloadExtension=1';

const chromePath = process.env.HHJA_CHROME_PATH || DEFAULT_CHROME_PATH;
const chromeProfile = process.env.HHJA_CHROME_PROFILE || DEFAULT_PROFILE;
const reloadUrl = process.argv[2] || DEFAULT_RELOAD_URL;

function validateReloadUrl(value) {
  const parsed = new URL(value);
  if (parsed.hostname !== 'hh.ru' && !parsed.hostname.endsWith('.hh.ru')) {
    throw new Error('Reload URL must be on hh.ru');
  }
  parsed.searchParams.set('hhjaReloadExtension', '1');
  return parsed.href;
}

const targetUrl = validateReloadUrl(reloadUrl);

try {
  const child = spawn(chromePath, [`--profile-directory=${chromeProfile}`, targetUrl], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  console.log(`Opened HH extension reload URL: ${targetUrl}`);
} catch (error) {
  const message = error.stderr || error.message || String(error);
  console.error(message.trim());
  process.exit(1);
}
