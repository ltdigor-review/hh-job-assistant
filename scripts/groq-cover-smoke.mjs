#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const EXTENSION_ID = process.env.HHJA_EXTENSION_ID || 'ohcopjcjekbfmlplembcbjocilnginmj';
const PROFILE = process.env.HHJA_CHROME_PROFILE || 'Profile 1';
const STORAGE_DIR = process.env.HHJA_EXTENSION_STORAGE_DIR || join(
  homedir(),
  'Library/Application Support/Google/Chrome',
  PROFILE,
  'Local Extension Settings',
  EXTENSION_ID
);
const SAMPLE_COUNT = Math.max(1, Math.min(Number(process.env.HHJA_GROQ_SMOKE_COUNT) || 8, 20));
const PROXY = process.env.HHJA_GROQ_PROXY || readMacHttpsProxy();
const MODEL = 'llama-3.3-70b-versatile';
const MAX_TOKENS = 120;
const TEMPERATURE = 0.2;

await import('../src/defaults.js');
const DEFAULTS = globalThis.HHJA_DEFAULTS;

function fail(message) {
  console.error(`Groq cover smoke failed: ${message}`);
  process.exit(1);
}

function readMacHttpsProxy() {
  if (process.platform !== 'darwin') return '';
  try {
    const text = execFileSync('scutil', ['--proxy'], { encoding: 'utf8' });
    if (!/HTTPSEnable\s*:\s*1/.test(text)) return '';
    const host = text.match(/HTTPSProxy\s*:\s*(\S+)/)?.[1] || '';
    const port = text.match(/HTTPSPort\s*:\s*(\d+)/)?.[1] || '';
    return host && port ? `http://${host}:${port}` : '';
  } catch {
    return '';
  }
}

function readKeyFromStorage(storageDir) {
  if (!existsSync(storageDir)) return '';
  const keys = new Set();
  for (const name of readdirSync(storageDir)) {
    const file = join(storageDir, name);
    try {
      if (!statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    const text = readFileSync(file).toString('latin1');
    for (const match of text.matchAll(/gsk_[A-Za-z0-9_-]{20,}/g)) {
      keys.add(match[0]);
    }
  }
  return [...keys][0] || '';
}

function buildMessages() {
  return [
    {
      role: 'system',
      content: [
        'Ты пишешь одну строку в поле сопроводительного письма hh.ru.',
        'Нужен обычный человеческий отклик, не письмо и не мотивационный текст.',
        'Строго: 1 предложение, 50-150 символов, русский язык, без приветствия.',
        'Пиши от первого лица: есть опыт, работал, делал, откликаюсь.',
        'Назови одно конкретное пересечение резюме и вакансии.',
        'Запрещено: соответствует требованиям вакансии, требования вакансии, проявлял интерес, Уважаемая команда, меня привлекла возможность, инновации, эффективность, масштабные проекты, высокий уровень качества, готов обсудить, готов применять, релевантный опыт, буду рад, чем могу быть полезен.',
        'Без списков, markdown, заголовков, объяснений, выдуманных фактов и пересказа вакансии.',
        'Верни только финальный текст.'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        DEFAULTS.coverPrompt,
        '',
        'Резюме:',
        'Backend/Tech Lead. JVM, Java, Kotlin, Spring Boot, микросервисы, REST API, Kafka, PostgreSQL. Руководил backend-командой, проектировал интеграции и высоконагруженные сервисы.',
        '',
        'Предпочтения кандидата:',
        '(не указано)',
        '',
        'Вакансия:',
        'Java Backend Developer. Нужны Java/Kotlin, Spring Boot, микросервисы, REST API, Kafka, PostgreSQL, опыт проектирования интеграций.',
        '',
        'Примеры стиля:',
        'Работал со Spring Boot и микросервисами, поэтому откликаюсь.',
        'Делал backend API и интеграции, поэтому откликаюсь.'
      ].join('\n')
    }
  ];
}

function validateHumanShortCoverLetter(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length < 20) return 'too_short';
  if (text.length > 150) return 'too_long';
  if (/[—–]/.test(text)) return 'dash';
  if (/^\s*(?:[-*]|\d+[.)])\s+/m.test(value)) return 'list';
  if (/[.!?]+.*[.!?]+/.test(text)) return 'multiple_sentences';
  if (!/(?:работал|делал|есть|имею|занимался|откликаюсь)/i.test(text)) return 'not_first_person_plain';
  if (/(?:уважаем|меня\s+привлекла|инновац|эффективност|масштабн|соответству(?:ет|ю)\s+требованиям|требования\s+вакансии|проявлял(?:а)?\s+интерес|готов(?:а)?\s+(?:обсудить|применять)\b|релевантн(?:ый|ого|ом)\s+опыт|чем\s+могу\s+быть\s+полезен|буду\s+рад|близк(?:ий|ая|ое|ие|о|и|а)?\s+к\s+моему\s+опыту|вакансия\s+выглядит\s+близко|вижу\s+пересечение)/i.test(text)) {
    return 'cliche';
  }
  return '';
}

function callGroq(key) {
  const requestBody = JSON.stringify({
    model: MODEL,
    messages: buildMessages(),
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS
  });
  const args = [
    '-sS',
    '-w',
    '\nHTTP_STATUS:%{http_code}\n',
    'https://api.groq.com/openai/v1/chat/completions',
    '-H',
    `Authorization: Bearer ${key}`,
    '-H',
    'Content-Type: application/json',
    '--data',
    requestBody
  ];
  if (PROXY) {
    args.splice(1, 0, '--proxy', PROXY);
  }
  const output = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  const status = output.match(/HTTP_STATUS:(\d+)/)?.[1] || 'unknown';
  const body = output.replace(/\nHTTP_STATUS:\d+\n?$/, '');
  if (status !== '200') {
    let error = body.slice(0, 200);
    try {
      const parsed = JSON.parse(body);
      error = parsed?.error?.message || parsed?.error || error;
    } catch {
      // Keep truncated body.
    }
    return { ok: false, status, error };
  }
  const data = JSON.parse(body);
  const text = data?.choices?.[0]?.message?.content?.trim() || '';
  return {
    ok: true,
    status,
    finishReason: data?.choices?.[0]?.finish_reason || '',
    text,
    length: text.length,
    invalidReason: validateHumanShortCoverLetter(text)
  };
}

const key = process.env.GROQ_API_KEY || process.env.HHJA_GROQ_API_KEY || readKeyFromStorage(STORAGE_DIR);
if (!key) fail(`Groq key not found in env or ${STORAGE_DIR}`);

const results = Array.from({ length: SAMPLE_COUNT }, () => callGroq(key));
const failed = results.find((item) => !item.ok || item.invalidReason);
const report = {
  model: MODEL,
  proxy: PROXY ? 'enabled' : 'disabled',
  key: { length: key.length, suffix: key.slice(-4) },
  samples: results
};
console.log(JSON.stringify(report, null, 2));
if (failed) {
  fail(failed.ok ? `invalid generated text: ${failed.invalidReason}` : `Groq HTTP ${failed.status}: ${failed.error}`);
}
