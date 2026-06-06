#!/usr/bin/env node

import { spawn } from 'node:child_process';

const DEFAULT_URL = 'https://hh.ru/search/vacancy?text=java&area=1&search_field=name&search_field=company_name&search_field=description&ored_clusters=true&page=2';
const DEFAULT_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_PROFILE = 'Profile 1';
const url = process.argv[2] || DEFAULT_URL;
const chromePath = process.env.HHJA_CHROME_PATH || DEFAULT_CHROME_PATH;
const chromeProfile = process.env.HHJA_CHROME_PROFILE || DEFAULT_PROFILE;
const autoLimit = process.env.HHJA_LIMIT || '';
const groqModel = process.env.HHJA_GROQ_MODEL || '';

function validateUrl(value) {
  const parsed = new URL(value);
  if (parsed.hostname !== 'hh.ru' && !parsed.hostname.endsWith('.hh.ru')) {
    throw new Error('URL must be on hh.ru');
  }
  if (parsed.pathname !== '/search/vacancy' && parsed.pathname !== '/applicant/vacancy_response') {
    throw new Error('URL must be an hh.ru vacancy search or response form page');
  }
  return parsed.href;
}

const targetUrl = validateUrl(url);
function withAutoStartParam(value) {
  const parsed = new URL(value);
  parsed.searchParams.set('hhjaAutoStart', 'live');
  if (autoLimit) {
    parsed.searchParams.set('hhjaLimit', String(Math.max(1, Math.min(Number(autoLimit) || 20, 100))));
  }
  if (groqModel) {
    parsed.searchParams.set('hhjaGroqModel', groqModel);
  }
  return parsed.href;
}

const autoStartUrl = withAutoStartParam(targetUrl);

try {
  const child = spawn(chromePath, [`--profile-directory=${chromeProfile}`, autoStartUrl], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  console.log(`Opened HH auto-start URL: ${autoStartUrl}`);
} catch (error) {
  const message = error.stderr || error.message || String(error);
  console.error(message.trim());
  process.exit(1);
}
