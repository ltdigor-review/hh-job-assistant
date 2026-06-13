#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const sourceProfile = resolve(
  process.env.HHJA_CHROME_COOKIE_PROFILE ||
    join(homedir(), 'Library/Application Support/Google/Chrome/Profile 1')
);
const targetProfileRoot = resolve(process.env.HHJA_CHROMIUM_USER_DATA_DIR || '.hhja-chromium-profile');
const targetProfile = resolve(process.env.HHJA_CHROMIUM_COOKIE_PROFILE || join(targetProfileRoot, 'Default'));
const sourceCookies = join(sourceProfile, 'Cookies');
const targetCookies = join(targetProfile, 'Cookies');
const cookieFilter = "host_key LIKE '%hh.ru%'";

const columns = [
  'creation_utc',
  'host_key',
  'top_frame_site_key',
  'name',
  'value',
  'encrypted_value',
  'path',
  'expires_utc',
  'is_secure',
  'is_httponly',
  'last_access_utc',
  'has_expires',
  'is_persistent',
  'priority',
  'samesite',
  'source_scheme',
  'source_port',
  'last_update_utc',
  'source_type',
  'has_cross_site_ancestor'
];

function fail(message) {
  console.error(`HH auth sync failed: ${message}`);
  process.exit(1);
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function requireFile(path, label) {
  try {
    await access(path);
  } catch {
    fail(`${label} not found: ${path}`);
  }
}

async function sqlite(database, sql) {
  const { stdout } = await execFileAsync('sqlite3', ['-batch', database, sql], {
    maxBuffer: 1024 * 1024 * 10
  });
  return stdout.trim();
}

await requireFile(sourceCookies, 'Source Chrome cookie DB');
await requireFile(targetCookies, 'Target Chromium cookie DB');
await mkdir(dirname(targetCookies), { recursive: true });

const sourceCount = Number(await sqlite(sourceCookies, `SELECT count(*) FROM cookies WHERE ${cookieFilter};`));
if (!sourceCount) {
  fail(`No hh.ru cookies found in source profile: ${sourceProfile}`);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `${targetCookies}.bak-${timestamp}`;
await copyFile(targetCookies, backupPath);

const columnList = columns.join(', ');
const sql = [
  `ATTACH DATABASE ${quoteSql(sourceCookies)} AS src;`,
  'PRAGMA busy_timeout = 5000;',
  'BEGIN IMMEDIATE;',
  `DELETE FROM main.cookies WHERE ${cookieFilter};`,
  `INSERT OR REPLACE INTO main.cookies (${columnList})`,
  `SELECT ${columnList} FROM src.cookies WHERE ${cookieFilter};`,
  'COMMIT;'
].join('\n');

try {
  await sqlite(targetCookies, sql);
} catch (error) {
  await copyFile(backupPath, targetCookies);
  fail(error instanceof Error ? error.message : String(error));
}

const targetCount = Number(await sqlite(targetCookies, `SELECT count(*) FROM cookies WHERE ${cookieFilter};`));
const evidencePath = join(targetProfileRoot, 'hh-auth-sync-last.json');
await writeFile(
  evidencePath,
  `${JSON.stringify({
    ok: true,
    sourceProfile,
    targetProfile,
    sourceCookieRows: sourceCount,
    targetCookieRows: targetCount,
    backupPath,
    syncedAt: new Date().toISOString()
  }, null, 2)}\n`,
  'utf8'
);

console.log(JSON.stringify({
  ok: true,
  sourceProfile,
  targetProfile,
  sourceCookieRows: sourceCount,
  targetCookieRows: targetCount,
  backupPath,
  evidencePath
}, null, 2));
