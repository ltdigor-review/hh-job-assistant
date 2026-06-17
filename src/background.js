import './agent-log.js';
import './error-text.js';
import './defaults.js';

const DEFAULTS = globalThis.HHJA_DEFAULTS;

const OLD_DEFAULT_COVER_PROMPT = 'Напиши короткое сопроводительное письмо для отклика на вакансию. Тон: деловой, уверенный, без выдуманного опыта.';
const OLD_DEFAULT_DELAY_MIN_MS = 8000;
const OLD_DEFAULT_DELAY_MAX_MS = 15000;
const GROQ_REQUEST_TIMEOUT_MS = 35000;
const RESPONSE_NAVIGATION_WATCHDOG_MS = 45000;
const RESUME_GROQ_BRIEF_VERSION = 'resume-brief-v1';
const RESUME_GROQ_BRIEF_MAX_CHARS = 1800;
const RESUME_GROQ_RETRY_BRIEF_MAX_CHARS = 800;
const VACANCY_GROQ_MAX_CHARS = 2200;
const EXTRA_GROQ_MAX_CHARS = 2200;
const COVER_PROMPT_GROQ_MAX_CHARS = 1000;
const GROQ_RATE_LIMIT_FALLBACK_COOLDOWN_MS = 60000;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  if (globalThis.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localizeError(error, fallback) {
  return globalThis.HHJA_LOCALIZE_ERROR?.(error, fallback) || fallback || 'Внутренняя ошибка расширения.';
}

function getGroqRequestTimeoutMs() {
  const testOverride = Number(globalThis.__HH_JOB_ASSISTANT_TEST_GROQ_TIMEOUT_MS__);
  if (Number.isFinite(testOverride) && testOverride > 0) {
    return testOverride;
  }
  return GROQ_REQUEST_TIMEOUT_MS;
}

function cleanPlainText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hashText(value) {
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function uniqueLines(text) {
  const seen = new Set();
  return cleanPlainText(text)
    .split('\n')
    .map((line) => cleanPlainText(line))
    .filter((line) => {
      if (!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
}

function joinCappedLines(lines, maxChars) {
  const output = [];
  let length = 0;
  for (const line of lines) {
    const nextLength = length + line.length + (output.length > 0 ? 1 : 0);
    if (nextLength > maxChars) break;
    output.push(line);
    length = nextLength;
  }
  return output.join('\n').slice(0, maxChars);
}

function compactVacancyText(value, maxChars = VACANCY_GROQ_MAX_CHARS) {
  const noisePattern = /^(?:откликнуться|показать контакты|в избранное|скрыть|пожаловаться|поделиться|назад|далее|похожие вакансии|вакансии компании|hh\.ru|headhunter)$/i;
  const lines = uniqueLines(value)
    .filter((line) => line.length <= 700)
    .filter((line) => !noisePattern.test(line))
    .filter((line) => !/^(?:откликнуться|показать|скрыть)\b/i.test(line));
  return joinCappedLines(lines, maxChars);
}

function compactExtraText(value, maxChars = EXTRA_GROQ_MAX_CHARS) {
  return joinCappedLines(uniqueLines(value).filter((line) => line.length <= 700), maxChars);
}

function buildResumeGroqBrief(sourceText, maxChars = RESUME_GROQ_BRIEF_MAX_CHARS) {
  const lines = uniqueLines(sourceText).filter((line) => line.length >= 3 && line.length <= 260);
  const selected = [];
  const used = new Set();
  const add = (line) => {
    const normalized = cleanPlainText(line);
    if (!normalized || used.has(normalized)) return;
    selected.push(normalized);
    used.add(normalized);
  };
  const addMatching = (pattern, limit) => {
    let added = 0;
    for (const line of lines) {
      if (added >= limit) break;
      if (pattern.test(line)) {
        add(line);
        added += 1;
      }
    }
  };

  lines.slice(0, 5).forEach(add);
  addMatching(/(?:java|spring|sql|postgres|kafka|redis|docker|kubernetes|микросервис|microservice|backend|frontend|react|node|python|groq|llm|ai|ml|rag|архитект|architecture)/i, 12);
  addMatching(/(?:опыт|experience|проект|project|разработ|develop|руковод|lead|team|команд|менедж|product|аналит|систем|интеграц|автоматизац)/i, 12);
  addMatching(/(?:t\.me\/|@[a-z0-9_]{4,}|wa\.me\/|telegram|телеграм|whatsapp|email|почта|телефон|contact|контакт)/i, 4);

  let brief = joinCappedLines(selected, maxChars);
  if (brief.length < Math.min(900, maxChars)) {
    for (const line of lines) {
      add(line);
      brief = joinCappedLines(selected, maxChars);
      if (brief.length >= Math.min(900, maxChars)) break;
    }
  }
  return brief || cleanPlainText(sourceText).slice(0, maxChars);
}

function parseRetryAfterMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const retryAt = Date.parse(raw);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : 0;
}

async function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

async function storageSet(value) {
  return chrome.storage.local.set(value);
}

async function appendAgentLog(event, details = {}) {
  await globalThis.HHJobAssistantLog?.append?.('background', event, details);
}

async function ensureDefaults() {
  const current = await storageGet(Object.keys(DEFAULTS));
  const patch = {};

  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (current[key] === undefined) {
      patch[key] = value;
    }
  }

  if (current.dailyLimit === 10) {
    patch.dailyLimit = DEFAULTS.dailyLimit;
  }

  if (current.coverPrompt === OLD_DEFAULT_COVER_PROMPT) {
    patch.coverPrompt = DEFAULTS.coverPrompt;
  }

  if (current.delayMinMs === OLD_DEFAULT_DELAY_MIN_MS && current.delayMaxMs === OLD_DEFAULT_DELAY_MAX_MS) {
    patch.delayMinMs = DEFAULTS.delayMinMs;
    patch.delayMaxMs = DEFAULTS.delayMaxMs;
  }

  if (Object.keys(patch).length > 0) {
    await storageSet(patch);
  }
}

async function setRunState(patch) {
  const { runState = DEFAULTS.runState } = await storageGet(['runState']);
  const terminalStates = new Set(['complete', 'idle', 'dry_run_complete', 'stopped', 'paused']);
  const nextPatch = { ...patch };
  if (terminalStates.has(nextPatch.state) && !Object.prototype.hasOwnProperty.call(nextPatch, 'currentAction')) {
    nextPatch.currentAction = '';
  }
  if (
    nextPatch.state &&
    nextPatch.state !== 'error' &&
    !Object.prototype.hasOwnProperty.call(nextPatch, 'lastError')
  ) {
    nextPatch.lastError = '';
  }

  const nextRunState = {
    ...DEFAULTS.runState,
    ...runState,
    ...nextPatch,
    updatedAt: nowIso()
  };
  await storageSet({
    runState: nextRunState
  });
  await appendAgentLog('run_state', {
    state: nextRunState.state,
    found: nextRunState.found,
    processed: nextRunState.processed,
    applied: nextRunState.applied,
    skipped: nextRunState.skipped,
    errors: nextRunState.errors,
    currentAction: nextRunState.currentAction,
    lastError: nextRunState.lastError
  });
}

async function appendRunResult(item) {
  const { runResults = [] } = await storageGet(['runResults']);
  const result = {
    ...item,
    timestamp: item.timestamp || nowIso()
  };
  await storageSet({
    runResults: [
      ...runResults.slice(-199),
      result
    ]
  });
  await appendAgentLog('run_result', result);
}

async function appendChatReport(item) {
  const { chatReports = [] } = await storageGet(['chatReports']);
  const report = {
    id: item.id || `${Date.now()}:${Math.random().toString(16).slice(2)}`,
    timestamp: item.timestamp || nowIso(),
    chatUrl: item.chatUrl || '',
    employerName: item.employerName || '',
    vacancyTitle: item.vacancyTitle || '',
    vacancyUrl: item.vacancyUrl || '',
    status: item.status || 'reported',
    reason: item.reason || '',
    contactType: item.contactType || '',
    contactText: item.contactText || '',
    questionText: item.questionText || '',
    draftAnswer: item.draftAnswer || '',
    sent: Boolean(item.sent),
    error: item.error || ''
  };
  await storageSet({
    chatReports: [
      ...chatReports.slice(-199),
      report
    ]
  });
  await appendAgentLog('chat_report', report);
}

function buildGroqMessages({ task, resumeText, expectedSalary, coverPrompt, vacancyText, extraText }) {
  if (task === 'chat_reply') {
    return [
      {
        role: 'system',
        content:
          'Answer hh.ru employer chat in concise Russian. Use only resume brief, vacancy, chat, salary. Do not invent facts. Return final reply only.'
      },
      {
        role: 'user',
        content: [
          'Резюме кандидата:',
          resumeText || '(резюме не указано)',
          '',
          'Ожидаемая зарплата кандидата:',
          expectedSalary || '(зарплата не указана)',
          '',
          'Вакансия:',
          vacancyText || '(текст вакансии не найден)',
          '',
          'Контекст чата и вопрос работодателя:',
          extraText || '(текст чата не найден)'
        ].join('\n')
      }
    ];
  }

  if (task === 'choice_retry') {
    return [
      {
        role: 'system',
        content:
          'Pick exact hh.ru choice option labels. Use only listed options and resume brief. Return lines: "Choice group N: <exact label>".'
      },
      {
        role: 'user',
        content: [
          'Резюме кратко:',
          resumeText || '(резюме не указано)',
          '',
          'Варианты и предыдущий ответ:',
          extraText || '(нет)'
        ].join('\n')
      }
    ];
  }

  if (task === 'test_assist') {
    return [
      {
        role: 'system',
        content:
          'Answer hh.ru screening questions in Russian. Use resume brief, vacancy, salary, exact options. Choice: "Choice group N: <exact option label(s)>". Text: "Text question N: <draft>". Avoid first-person pronouns. Do not invent facts.'
      },
      {
        role: 'user',
        content: [
          'Резюме кандидата:',
          resumeText || '(резюме не указано)',
          '',
          'Ожидаемая зарплата кандидата:',
          expectedSalary || '(зарплата не указана)',
          '',
          'Текст вакансии или теста:',
          vacancyText || '(текст не найден)',
          '',
          'Структурированные вопросы и варианты ответа со страницы:',
          extraText || '(нет)'
        ].join('\n')
      }
    ];
  }

  return [
    {
      role: 'system',
      content:
        'Write a short honest hh.ru cover letter in Russian, 3-4 sentences. No invented facts, placeholders, labels, or unknown names. Return final text only.'
    },
    {
      role: 'user',
      content: [
        coverPrompt || DEFAULTS.coverPrompt,
        '',
        'Резюме:',
        resumeText || '(резюме не указано)',
        '',
        'Вакансия:',
        vacancyText || '(текст вакансии не найден)'
      ].join('\n')
    }
  ];
}

function normalizeResumeUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value).trim());
    if ((url.hostname !== 'hh.ru' && !url.hostname.endsWith('.hh.ru')) || !/^\/resume\/[^/?#]+/.test(url.pathname)) {
      return '';
    }
    return url.href;
  } catch {
    return '';
  }
}

function isHhUrl(value) {
  try {
    const hostname = new URL(String(value || '')).hostname;
    return hostname === 'hh.ru' || hostname.endsWith('.hh.ru');
  } catch {
    return false;
  }
}

function extractResumeTextScript() {
  const text = (document.body?.innerText || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (/\/account\/login|\/account\/signup/.test(location.pathname) || /captcha|подтвердите, что вы не робот|не робот/i.test(text)) {
    return { ok: false, error: 'Обнаружена страница входа или captcha', text: '' };
  }

  const main = document.querySelector('main')?.innerText || text;
  return {
    ok: true,
    title: document.title,
    text: String(main)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 12000)
  };
}

function extractVacancyTextScript() {
  const text = (document.body?.innerText || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (/\/account\/login|\/account\/signup/.test(location.pathname) || /captcha|подтвердите, что вы не робот|не робот/i.test(text)) {
    return { ok: false, error: 'Обнаружена страница входа или captcha', text: '' };
  }

  const node =
    document.querySelector('[data-qa="vacancy-description"]') ||
    document.querySelector('[data-qa="vacancy-section"]') ||
    document.querySelector('[data-qa="vacancy-view-description"]') ||
    document.querySelector('main') ||
    document.body;

  return {
    ok: true,
    title: document.title,
    text: String(node?.innerText || text)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 12000)
  };
}

function normalizeVacancyUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value).trim());
    if ((url.hostname !== 'hh.ru' && !url.hostname.endsWith('.hh.ru')) || !/^\/vacancy\/\d+/.test(url.pathname)) {
      return '';
    }
    return url.href;
  } catch {
    return '';
  }
}

async function getVacancyContextByUrl(vacancyUrl) {
  const normalizedUrl = normalizeVacancyUrl(vacancyUrl);
  if (!normalizedUrl) return '';

  const tab = await chrome.tabs.create({ url: normalizedUrl, active: false });
  try {
    await waitForTabReady(tab.id, 30000);
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractVacancyTextScript
    });
    const result = execution?.result || { ok: false, error: 'Не получен результат разбора вакансии', text: '' };
    if (!result.ok) {
      throw new Error(result.error || 'Не удалось разобрать вакансию');
    }
    return String(result.text || '').slice(0, 12000);
  } finally {
    if (tab.id) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function getResumeContext() {
  const {
    resumeUrl = '',
    resumeParsedText = '',
    resumeParsedAt = '',
    resumeCacheTtlHours = DEFAULTS.resumeCacheTtlHours,
    resumeText = ''
  } = await storageGet(['resumeUrl', 'resumeParsedText', 'resumeParsedAt', 'resumeCacheTtlHours', 'resumeText']);
  const normalizedUrl = normalizeResumeUrl(resumeUrl);
  if (!normalizedUrl) {
    return String(resumeText || '').slice(0, 12000);
  }

  const ttlHours = Math.max(0.1, Math.min(Number(resumeCacheTtlHours) || DEFAULTS.resumeCacheTtlHours, 168));
  const cacheAgeMs = Date.now() - Date.parse(resumeParsedAt || 0);
  if (resumeParsedText && Number.isFinite(cacheAgeMs) && cacheAgeMs < ttlHours * 60 * 60 * 1000) {
    return String(resumeParsedText).slice(0, 12000);
  }

  const tab = await chrome.tabs.create({ url: normalizedUrl, active: false });
  try {
    await waitForTabReady(tab.id, 30000);
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractResumeTextScript
    });
    const result = execution?.result || { ok: false, error: 'Не получен результат разбора резюме', text: '' };
    if (!result.ok) {
      throw new Error(result.error || 'Не удалось разобрать резюме');
    }
    const text = String(result.text || '').slice(0, 12000);
    await storageSet({
      resumeParsedText: text,
      resumeParsedAt: nowIso(),
      resumeGroqBriefText: '',
      resumeGroqBriefSourceHash: '',
      resumeGroqBriefBuiltAt: '',
      resumeGroqBriefVersion: ''
    });
    return text;
  } finally {
    if (tab.id) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function getResumeGroqContext(sourceText, maxChars = RESUME_GROQ_BRIEF_MAX_CHARS) {
  const source = String(sourceText || '').slice(0, 12000);
  const sourceHash = hashText(source);
  const {
    resumeGroqBriefText = '',
    resumeGroqBriefSourceHash = '',
    resumeGroqBriefVersion = '',
    resumeGroqBriefBuiltAt = ''
  } = await storageGet(['resumeGroqBriefText', 'resumeGroqBriefSourceHash', 'resumeGroqBriefVersion', 'resumeGroqBriefBuiltAt']);

  if (
    resumeGroqBriefText &&
    resumeGroqBriefSourceHash === sourceHash &&
    resumeGroqBriefVersion === RESUME_GROQ_BRIEF_VERSION
  ) {
    return {
      text: String(resumeGroqBriefText).slice(0, maxChars),
      sourceHash,
      sourceLength: source.length,
      briefLength: String(resumeGroqBriefText).length,
      version: resumeGroqBriefVersion,
      builtAt: resumeGroqBriefBuiltAt,
      cached: true
    };
  }

  const brief = buildResumeGroqBrief(source, RESUME_GROQ_BRIEF_MAX_CHARS);
  const builtAt = nowIso();
  await storageSet({
    resumeGroqBriefText: brief,
    resumeGroqBriefSourceHash: sourceHash,
    resumeGroqBriefBuiltAt: builtAt,
    resumeGroqBriefVersion: RESUME_GROQ_BRIEF_VERSION
  });
  return {
    text: brief.slice(0, maxChars),
    sourceHash,
    sourceLength: source.length,
    briefLength: brief.length,
    version: RESUME_GROQ_BRIEF_VERSION,
    builtAt,
    cached: false
  };
}

function getMaxTokensForTask(task) {
  if (task === 'test_assist') return 700;
  if (task === 'choice_retry') return 300;
  return 250;
}

function normalizeUsage(usage = {}) {
  return {
    promptTokens: Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : null,
    completionTokens: Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : null,
    totalTokens: Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : null
  };
}

async function callGroq({ task = 'cover_letter', vacancyText = '', extraText = '' }) {
  const {
    groqApiKey,
    groqModel = DEFAULTS.groqModel,
    expectedSalary = '',
    coverPrompt = DEFAULTS.coverPrompt,
    groqCooldownUntil = ''
  } = await storageGet(['groqApiKey', 'groqModel', 'expectedSalary', 'coverPrompt', 'groqCooldownUntil']);

  if (!groqApiKey) {
    throw new Error('Ключ Groq API не настроен');
  }

  const cooldownUntilMs = Date.parse(groqCooldownUntil || 0);
  if (Number.isFinite(cooldownUntilMs) && cooldownUntilMs > Date.now()) {
    await appendAgentLog('groq_request_skipped', {
      task,
      reason: 'cooldown',
      cooldownUntil: groqCooldownUntil
    });
    throw new Error(`Groq временно ограничил запросы. Пауза до ${groqCooldownUntil}.`);
  }

  const resumeSourceText = await getResumeContext();
  const resumeContext = await getResumeGroqContext(
    resumeSourceText,
    task === 'choice_retry' ? RESUME_GROQ_RETRY_BRIEF_MAX_CHARS : RESUME_GROQ_BRIEF_MAX_CHARS
  );
  const payloadParts = {
    resumeText: resumeContext.text,
    expectedSalary: String(expectedSalary).slice(0, 1000),
    coverPrompt: String(coverPrompt).slice(0, COVER_PROMPT_GROQ_MAX_CHARS),
    vacancyText: task === 'choice_retry' ? '' : compactVacancyText(vacancyText),
    extraText: compactExtraText(extraText)
  };
  await appendAgentLog('groq_request_start', {
    task,
    model: groqModel || DEFAULTS.groqModel,
    vacancyTextLength: String(vacancyText).length,
    extraTextLength: String(extraText).length,
    resumeSourceLength: String(resumeSourceText).length,
    resumeBriefLength: payloadParts.resumeText.length,
    resumeBriefVersion: resumeContext.version
  });

  const timeoutMs = getGroqRequestTimeoutMs();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const requestBody = {
    model: groqModel || DEFAULTS.groqModel,
    messages: buildGroqMessages({
      task,
      ...payloadParts
    }),
    temperature: task === 'test_assist' ? 0.2 : 0.35,
    max_tokens: getMaxTokensForTask(task)
  };
  await appendAgentLog('groq_request_payload', {
    task,
    model: requestBody.model,
    messageCount: requestBody.messages.length,
    messageLengths: requestBody.messages.map((message) => ({
      role: message.role,
      contentLength: String(message.content || '').length
    })),
    temperature: requestBody.temperature,
    maxTokens: requestBody.max_tokens,
    componentLengths: {
      resumeSource: resumeContext.sourceLength,
      resumeBrief: payloadParts.resumeText.length,
      expectedSalary: payloadParts.expectedSalary.length,
      coverPrompt: payloadParts.coverPrompt.length,
      vacancy: payloadParts.vacancyText.length,
      extra: payloadParts.extraText.length
    },
    componentHashes: {
      resumeSource: resumeContext.sourceHash,
      resumeBrief: hashText(payloadParts.resumeText),
      vacancy: hashText(payloadParts.vacancyText),
      extra: hashText(payloadParts.extraText)
    },
    resumeBriefVersion: resumeContext.version,
    resumeBriefCached: resumeContext.cached
  });
  let response;
  try {
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      await appendAgentLog('groq_request_error', { task, error: 'timeout', timeoutMs });
      throw new Error(`Запрос Groq не уложился в ${timeoutMs} мс`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after')) || GROQ_RATE_LIMIT_FALLBACK_COOLDOWN_MS;
      const cooldownUntil = new Date(Date.now() + retryAfterMs).toISOString();
      await storageSet({ groqCooldownUntil: cooldownUntil });
      await appendAgentLog('groq_rate_limit_cooldown', { task, cooldownUntil, retryAfterMs });
    }
    await appendAgentLog('groq_request_error', {
      task,
      status: response.status,
      responseText: text.slice(0, 200)
    });
    await appendAgentLog('groq_error_payload', {
      task,
      status: response.status,
      responseText: text.slice(0, 500)
    });
    throw new Error(`Запрос Groq завершился ошибкой: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    await appendAgentLog('groq_request_error', { task, status: response.status, error: 'empty_response' });
    throw new Error('Groq вернул пустой ответ');
  }
  await appendAgentLog('groq_response_payload', {
    task,
    responseLength: content.length,
    choiceCount: Array.isArray(data?.choices) ? data.choices.length : 0,
    model: data?.model || '',
    usage: normalizeUsage(data?.usage)
  });
  await appendAgentLog('groq_request_complete', { task, responseLength: content.length, usage: normalizeUsage(data?.usage) });
  return content;
}

async function generateChatReply({ vacancyUrl = '', vacancyText = '', chatText = '' }) {
  const parsedVacancyText = vacancyText || await getVacancyContextByUrl(vacancyUrl);
  return callGroq({
    task: 'chat_reply',
    vacancyText: parsedVacancyText,
    extraText: chatText
  });
}

async function testGroq() {
  const text = await callGroq({
    task: 'cover_letter',
    vacancyText: 'Вакансия: Java developer. Требуется знание Spring Boot и SQL.'
  });
  return { ok: true, sampleLength: text.length };
}

async function getTabDocumentReadyState(tabId) {
  try {
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.readyState
    });
    return execution?.result || '';
  } catch {
    return '';
  }
}

async function waitForTabReady(tabId, timeoutMs = 30000) {
  const currentTab = await chrome.tabs.get(tabId).catch(() => null);
  if (currentTab?.status === 'complete') {
    return;
  }

  const currentReadyState = await getTabDocumentReadyState(tabId);
  if (currentReadyState === 'interactive' || currentReadyState === 'complete') {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(poll);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Вкладка не загрузилась вовремя'));
    }, timeoutMs);

    function finish() {
      clearTimeout(timeout);
      clearInterval(poll);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    async function checkReady() {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab?.status === 'complete') {
        finish();
        return;
      }

      const readyState = await getTabDocumentReadyState(tabId);
      if (readyState === 'interactive' || readyState === 'complete') {
        finish();
      }
    }

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && (info.status === 'complete' || info.status === 'loading')) {
        checkReady().catch(() => {});
      }
    }

    const poll = setInterval(() => {
      checkReady().catch(() => {});
    }, 500);

    chrome.tabs.onUpdated.addListener(listener);
    checkReady().catch((error) => {
      if (error instanceof Error && /No tab/.test(error.message)) {
        clearTimeout(timeout);
        clearInterval(poll);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(error);
      }
    });
  });
}

async function waitForContentStatus(tabId, timeoutMs = 10000) {
  const started = Date.now();
  let lastError = '';

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_CONTENT_STATUS' });
      if (response?.ok) return response;
      lastError = response?.error || 'Контент-скрипт еще не готов';
    } catch (error) {
      lastError = error?.message || String(error);
    }
    await sleep(250);
  }

  throw new Error(`Контент-скрипт hh.ru не загрузился вовремя: ${lastError || 'нет ответа'}`);
}

function resumeRefreshPageActionScript(kind, actionText = '', status = 'running') {
  const PANEL_ID = 'hh-job-assistant-resume-refresh-panel';
  const CURSOR_ID = 'hh-job-assistant-resume-refresh-cursor';
  const HIGHLIGHT_ATTR = 'data-hh-job-assistant-highlight';
  const overlay = new globalThis.HHJobAssistantActionOverlay({
    panelId: PANEL_ID,
    cursorId: CURSOR_ID,
    highlightAttr: HIGHLIGHT_ATTR,
    defaultText: 'Обновление резюме'
  });

  const visible = (node) => {
    if (!node) return false;
    if (node.disabled || node.getAttribute?.('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  };

  const textOf = (node) =>
    (
      node?.innerText ||
      node?.textContent ||
      node?.value ||
      node?.getAttribute?.('aria-label') ||
      node?.getAttribute?.('title') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  const sleep = (ms) => {
    if (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  const highlight = (node) => {
    overlay.highlight(node);
  };

  const findByText = (root, selectors, patterns, rejectPatterns = []) => {
    const nodes = [...root.querySelectorAll(selectors.join(','))].filter(visible);
    return nodes.find((node) => {
      const text = textOf(node);
      if (rejectPatterns.some((pattern) => pattern.test(text))) return false;
      return patterns.some((pattern) => pattern.test(text));
    });
  };

  const findControl = (patterns, rejectPatterns = []) =>
    findByText(document, ['button', 'a', '[role="button"]', 'input[type="submit"]'], patterns, rejectPatterns);

  const isUnsafePage =
    /\/account\/login|\/account\/signup/.test(location.pathname) ||
    /captcha|подтвердите, что вы не робот|не робот/i.test(document.body.innerText || '');

  return (async () => {
    if (kind === 'status') {
      overlay.setStatus(actionText, status);
      return { ok: true, title: document.title, action: 'status' };
    }

    if (kind === 'complete') {
      overlay.clearHighlights();
      overlay.setStatus(actionText || 'Готово', 'complete');
      return { ok: true, title: document.title, action: 'complete' };
    }

    if (kind === 'error') {
      overlay.setStatus(actionText || 'Ошибка', 'error');
      return { ok: true, title: document.title, action: 'error' };
    }

    if (isUnsafePage) {
      overlay.setStatus('Обнаружена страница входа или captcha', 'error');
      return { ok: false, error: 'Обнаружена страница входа или captcha' };
    }

    if (kind === 'click_edit') {
      overlay.setStatus(actionText || 'Нажимаю Редактировать');
      const button = findControl([/редактировать/i, /изменить/i], [/видимость/i, /настро/i]);
      if (!button) return { ok: false, error: 'Кнопка редактирования не найдена' };
      highlight(button);
      await sleep(500);
      button.click();
      await sleep(1000);
      return { ok: true, title: document.title, action: 'clicked_edit', href: button.href || '' };
    }

    if (kind === 'click_save') {
      overlay.setStatus(actionText || 'Сохраняю без изменений');
      const button = findControl([/сохранить/i, /^готово$/i, /save/i], [/отмена/i, /cancel/i]);
      if (!button) return { ok: false, error: 'Кнопка сохранения не найдена' };
      highlight(button);
      await sleep(500);
      button.click();
      await sleep(1500);
      return { ok: true, title: document.title, action: 'clicked_save' };
    }

    if (kind === 'find_raise' || kind === 'click_raise') {
      overlay.setStatus(actionText || 'Проверяю возможность поднятия');
      const button = findControl(
        [
          /^обновить$/i,
          /поднять(?:\s+резюме)?(?:\s+в\s+поиске)?/i,
          /обновить\s+(?:дату|резюме)/i,
          /обновить\s+в\s+поиске/i
        ],
        [/редактировать/i, /сохранить/i, /создать/i]
      );
      if (!button) {
        return { ok: true, title: document.title, action: 'raise_not_available', raiseSkipped: true };
      }
      highlight(button);
      if (kind === 'find_raise') {
        return { ok: true, title: document.title, action: 'raise_available', raiseSkipped: false };
      }
      await sleep(500);
      button.click();
      await sleep(1500);
      return { ok: true, title: document.title, action: 'clicked_raise', raiseSkipped: false };
    }

    return { ok: false, error: `Неизвестное действие обновления резюме: ${kind || 'пусто'}` };
  })();
}

async function getActiveHhTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isHhUrl(tab.url)) {
    throw new Error('Откройте вкладку hh.ru и повторите');
  }
  return tab;
}

async function executeResumeRefreshPageAction(tabId, kind, actionText = '', status = 'running') {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/action-overlay.js']
  });
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    func: resumeRefreshPageActionScript,
    args: [kind, actionText, status]
  });
  return execution?.result || { ok: false, error: 'Не получен результат действия на странице резюме' };
}

async function setResumeRefreshAction(tabId, currentAction, status = 'running') {
  await setRunState({ state: 'refreshing_resumes', currentAction, lastError: '' });
  await executeResumeRefreshPageAction(tabId, 'status', currentAction, status).catch(() => {});
}

async function runCheckedResumePageAction(tabId, kind, currentAction) {
  await setResumeRefreshAction(tabId, currentAction);
  const result = await executeResumeRefreshPageAction(tabId, kind, currentAction);
  if (!result.ok) {
    throw new Error(result.error || `${currentAction}: действие не выполнено`);
  }
  return result;
}

async function runResumeRefresh() {
  let tabId = null;
  let currentAction = 'Открываю резюме';
  let normalizedUrl = '';

  try {
    await globalThis.HHJobAssistantLog?.reset?.('background', 'resume_refresh_started', {
      action: 'refresh_resumes'
    });
    const { resumeUrl = '' } = await storageGet(['resumeUrl']);
    normalizedUrl = normalizeResumeUrl(resumeUrl);
    if (!normalizedUrl) {
      throw new Error('Укажите ссылку на резюме в настройках');
    }

    const tab = await getActiveHhTab();
    tabId = tab.id;

    await setRunState({
      state: 'refreshing_resumes',
      found: 1,
      processed: 0,
      skipped: 0,
      errors: 0,
      currentAction,
      lastError: ''
    });
    await executeResumeRefreshPageAction(tabId, 'status', currentAction).catch(() => {});

    await chrome.tabs.update(tabId, { url: normalizedUrl });
    await waitForTabReady(tabId, 30000);
    await sleep(1000);
    await executeResumeRefreshPageAction(tabId, 'status', currentAction).catch(() => {});

    currentAction = 'Нажимаю Редактировать';
    const editResult = await runCheckedResumePageAction(tabId, 'click_edit', currentAction);
    await waitForTabReady(tabId, 30000);
    await sleep(1000);

    currentAction = 'Сохраняю без изменений';
    const saveResult = await runCheckedResumePageAction(tabId, 'click_save', currentAction);
    await waitForTabReady(tabId, 30000);
    await sleep(1500);

    currentAction = 'Проверяю возможность поднятия';
    await setResumeRefreshAction(tabId, currentAction);
    const raiseCheck = await executeResumeRefreshPageAction(tabId, 'find_raise', currentAction);
    if (!raiseCheck.ok) {
      throw new Error(raiseCheck.error || 'Не удалось проверить поднятие резюме');
    }

    let raiseResult = raiseCheck;
    if (!raiseCheck.raiseSkipped) {
      currentAction = 'Поднимаю резюме';
      raiseResult = await runCheckedResumePageAction(tabId, 'click_raise', currentAction);
      await waitForTabReady(tabId, 30000);
      await sleep(1000);
    }

    const result = {
      ok: true,
      results: [
        {
          href: normalizedUrl,
          edit: editResult.action,
          save: saveResult.action,
          raise: raiseResult.action,
          raiseSkipped: Boolean(raiseResult.raiseSkipped)
        }
      ],
      raiseSkipped: Boolean(raiseResult.raiseSkipped),
      error: ''
    };

    await appendRunResult({
      index: 0,
      vacancyId: '',
      title: 'Resume refresh',
      url: normalizedUrl,
      status: result.raiseSkipped ? 'resume_refresh_saved' : 'resume_refresh_complete',
      coverLetterUsed: false,
      testDetected: false,
      error: ''
    });

    await setRunState({ state: 'idle', processed: 1, currentAction: 'Готово', lastError: '' });
    await executeResumeRefreshPageAction(tabId, 'complete', 'Готово', 'complete').catch(() => {});
    return result;
  } catch (error) {
    const message = localizeError(error);
    await setRunState({ state: 'error', errors: 1, currentAction, lastError: message });
    if (tabId) {
      await executeResumeRefreshPageAction(tabId, 'error', `${currentAction}\n${message}`, 'error').catch(() => {});
    }
    return { ok: false, error: message };
  }
}

async function runChatAssistFromActiveTab() {
  await globalThis.HHJobAssistantLog?.reset?.('background', 'chat_assist_started', {
    action: 'chat_assist'
  });
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let tab = activeTab;
  let shouldWaitForContentScript = false;

  if (!tab?.id || !isHhUrl(tab.url)) {
    tab = await chrome.tabs.create({ url: 'https://hh.ru/chat', active: true });
    shouldWaitForContentScript = true;
  }

  let tabId = tab.id;
  const tabUrl = new URL(tab.url || 'https://hh.ru/chat');

  if (tabUrl.pathname !== '/chat') {
    const updatedTab = await chrome.tabs.update(tabId, { url: 'https://hh.ru/chat' });
    tabId = updatedTab?.id || tabId;
    shouldWaitForContentScript = true;
  }

  if (shouldWaitForContentScript) {
    await waitForTabReady(tabId, 30000);
    await waitForContentStatus(tabId, 10000);
  }

  return chrome.tabs.sendMessage(tabId, { type: 'START_CHAT_ASSIST' });
}

function isAutoApplyStartUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' &&
      (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru')) &&
      url.pathname === '/search/vacancy' &&
      url.search.length > 0;
  } catch {
    return false;
  }
}

function isHhResponseFormUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' &&
      (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru')) &&
      url.pathname === '/applicant/vacancy_response';
  } catch {
    return false;
  }
}

function getVacancyIdFromUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.searchParams.get('vacancyId') || '';
  } catch {
    return '';
  }
}

function getResponseNavigationWatchdogMs() {
  const testOverride = Number(globalThis.__HH_JOB_ASSISTANT_TEST_RESPONSE_WATCHDOG_MS__);
  if (Number.isFinite(testOverride) && testOverride > 0) {
    return testOverride;
  }
  return RESPONSE_NAVIGATION_WATCHDOG_MS;
}

async function recoverStalledResponseNavigation(tabId, expectedUrl, scheduledAt) {
  const { autoApplyQueue, autoApplySearchQueue, runState = DEFAULTS.runState } = await storageGet([
    'autoApplyQueue',
    'autoApplySearchQueue',
    'runState'
  ]);
  if (!autoApplyQueue?.active || !autoApplyQueue.returnToSearch || !isAutoApplyStartUrl(autoApplyQueue.sourceUrl)) {
    return;
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.id || tab.url !== expectedUrl || !isHhResponseFormUrl(tab.url)) {
    return;
  }

  const stateUpdatedAt = Date.parse(runState.updatedAt || '');
  if (Number.isFinite(stateUpdatedAt) && stateUpdatedAt > scheduledAt) {
    return;
  }

  const counters = {
    found: 0,
    processed: 0,
    applied: 0,
    skipped: 0,
    errors: 0,
    ...(autoApplyQueue.counters || autoApplySearchQueue?.counters || {})
  };
  counters.processed = Math.max(Number(counters.processed) || 0, Number(runState.processed) || 0);
  counters.applied = Math.max(Number(counters.applied) || 0, Number(runState.applied) || 0);
  counters.skipped = Math.max(Number(counters.skipped) || 0, Number(runState.skipped) || 0) + 1;
  counters.errors = Math.max(Number(counters.errors) || 0, Number(runState.errors) || 0);
  counters.found = Math.max(Number(counters.found) || 0, Number(runState.found) || 0);

  const item = autoApplyQueue.items?.[autoApplyQueue.index || 0] || {};
  const vacancyId = item.vacancyId || getVacancyIdFromUrl(expectedUrl);
  const message = 'Пропущено: страница отклика HH не загрузилась вовремя.';
  await appendRunResult({
    index: item.index || Number(autoApplyQueue.index || 0) + 1,
    vacancyId,
    title: item.title || '',
    url: item.url || expectedUrl,
    status: 'skipped_response_page_timeout',
    coverLetterUsed: false,
    testDetected: Boolean(item.testDetected),
    error: message
  });
  await storageSet({
    autoApplyQueue: { ...autoApplyQueue, active: false, recoveredFromUrl: expectedUrl, counters },
    autoApplySearchQueue: {
      active: true,
      runId: autoApplyQueue.runId || autoApplySearchQueue?.runId || '',
      limit: autoApplyQueue.limit || autoApplySearchQueue?.limit || 20,
      counters,
      config: autoApplyQueue.config || autoApplySearchQueue?.config,
      processedVacancyIds: autoApplyQueue.processedVacancyIds || autoApplySearchQueue?.processedVacancyIds || []
    }
  });
  await setRunState({ state: 'applying', ...counters, currentAction: 'Возвращаюсь на страницу поиска HH', lastError: message });
  await appendAgentLog('response_navigation_watchdog_recovered', {
    tabId,
    vacancyId,
    responseUrl: expectedUrl,
    sourceUrl: autoApplyQueue.sourceUrl
  });
  await chrome.tabs.update(tabId, { url: autoApplyQueue.sourceUrl }).catch(() => {});
}

function scheduleResponseNavigationWatchdog(tabId, url) {
  if (!tabId || !isHhResponseFormUrl(url)) return;
  const scheduledAt = Date.now();
  setTimeout(() => {
    recoverStalledResponseNavigation(tabId, url, scheduledAt).catch((error) => {
      appendAgentLog('response_navigation_watchdog_error', {
        tabId,
        url,
        error: localizeError(error)
      }).catch(() => {});
    });
  }, getResponseNavigationWatchdogMs());
}

async function startAutoApplyFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isAutoApplyStartUrl(tab.url)) {
    throw new Error('Перед запуском откликов откройте https://hh.ru/search/vacancy?...');
  }
  await appendAgentLog('command_start_auto_apply', { tabId: tab.id, url: tab.url });
  return chrome.tabs.sendMessage(tab.id, { type: 'START_AUTO_APPLY' });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
});

chrome.commands?.onCommand?.addListener((command) => {
  (async () => {
    await ensureDefaults();
    if (command === 'start-auto-apply') {
      const result = await startAutoApplyFromActiveTab();
      await appendAgentLog('command_start_auto_apply_result', result || {});
    }
  })().catch((error) => {
    appendAgentLog('command_error', {
      command,
      error: localizeError(error)
    }).catch(() => {});
  });
});

chrome.tabs?.onUpdated?.addListener?.((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || '';
  scheduleResponseNavigationWatchdog(tabId, url);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await ensureDefaults();

    switch (message?.type) {
      case 'GET_STATUS': {
        const state = await storageGet(['runState', 'runResults']);
        sendResponse({ ok: true, ...state });
        break;
      }
      case 'GET_CHAT_REPORTS': {
        const { chatReports = [] } = await storageGet(['chatReports']);
        sendResponse({ ok: true, chatReports });
        break;
      }
      case 'CLEAR_CHAT_REPORTS': {
        await storageSet({ chatReports: [] });
        sendResponse({ ok: true });
        break;
      }
      case 'RELOAD_EXTENSION': {
        await appendAgentLog('reload_extension', {
          reason: message.reason || 'manual',
          url: message.url || sender?.tab?.url || ''
        });
        sendResponse({ ok: true, reloading: true });
        chrome.runtime.reload();
        break;
      }
      case 'SET_RUN_STATE': {
        await setRunState(message.patch || {});
        sendResponse({ ok: true });
        break;
      }
      case 'APPEND_RUN_RESULT': {
        await appendRunResult(message.item || {});
        sendResponse({ ok: true });
        break;
      }
      case 'APPEND_CHAT_REPORT': {
        await appendChatReport(message.item || {});
        sendResponse({ ok: true });
        break;
      }
      case 'GENERATE_COVER_LETTER': {
        const text = await callGroq({
          task: message.task || 'cover_letter',
          vacancyText: message.vacancyText || '',
          extraText: message.extraText || ''
        });
        sendResponse({ ok: true, text });
        break;
      }
      case 'GENERATE_CHAT_REPLY': {
        const text = await generateChatReply({
          vacancyUrl: message.vacancyUrl || '',
          vacancyText: message.vacancyText || '',
          chatText: message.chatText || ''
        });
        sendResponse({ ok: true, text });
        break;
      }
      case 'TEST_GROQ': {
        const result = await testGroq();
        sendResponse(result);
        break;
      }
      case 'REFRESH_RESUMES_NOW': {
        const result = await runResumeRefresh();
        sendResponse(result);
        break;
      }
      case 'START_CHAT_ASSIST': {
        const result = await runChatAssistFromActiveTab();
        sendResponse(result);
        break;
      }
      default:
        sendResponse({ ok: false, error: `Unknown message type: ${message?.type || 'empty'}` });
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: localizeError(error) });
  });

  return true;
});

ensureDefaults().catch((error) => {
  console.error('Ошибка запуска HH Job Assistant:', error);
});
