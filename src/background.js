import './agent-log.js';
import './error-text.js';
import './defaults.js';
import './config-readiness.js';

const DEFAULTS = globalThis.HHJA_DEFAULTS;

const OLD_DEFAULT_COVER_PROMPTS = new Set([
  'Напиши короткое сопроводительное письмо для отклика на вакансию. Тон: деловой, уверенный, без выдуманного опыта.',
  'Напиши сопроводительное письмо на русском: 3-4 коротких предложения, без плейсхолдеров, без шаблонных скобок, без выдуманного опыта. Только готовый текст письма.',
  'Напиши сопроводительное письмо на русском: 3-4 коротких предложения, до 450 символов. Без списков, заголовков, markdown, плейсхолдеров, шаблонных скобок, неизвестных имен и выдуманного опыта. Не пересказывай резюме или вакансию. Только готовый текст письма.',
  'Напиши короткий живой отклик на русском: 1-2 простых предложения, до 220 символов. Без обращения, канцелярита, HR-клише, списков, markdown, выдуманного опыта и пересказа резюме или вакансии. Только готовый текст.',
  'Напиши одну живую строку для отклика hh.ru: 70-160 символов, по-русски, без приветствия. Используй конкретное пересечение резюме и вакансии. Без канцелярита, HR-клише, markdown, списков и фраз "готов обсудить", "релевантный опыт". Только текст.',
  'Напиши одну живую строку для отклика hh.ru: 70-150 символов, по-русски, без приветствия. Пиши от первого лица и используй конкретное пересечение резюме и вакансии. Без канцелярита, HR-клише, markdown, списков и фраз "готов обсудить", "релевантный опыт", "соответствует требованиям". Только текст.',
  'Напиши одну живую строку для отклика hh.ru: 50-150 символов, по-русски, без приветствия. Пиши от первого лица и используй конкретное пересечение резюме и вакансии. Без канцелярита, HR-клише, markdown, списков и фраз "готов обсудить", "релевантный опыт", "соответствует требованиям". Только текст.'
]);
const OLD_DEFAULT_EMPLOYER_QUESTION_PROMPTS = new Set([
  'Отвечай на вопросы работодателя на русском так, чтобы повысить шанс получить приглашение на собеседование. Если в резюме нет прямого опыта по вопросу, не пиши, что опыта нет; придумай уверенный релевантный кейс из близкого опыта, инструментов кандидата, вакансии и домена. Отвечай кратко, естественно, уверенно, без списков и без местоимений первого лица.',
  'Отвечай на вопросы работодателя на языке вопроса так, чтобы повысить шанс получить приглашение. Используй зарплату, контакты и точные варианты из контекста кандидата. Если в резюме нет прямого опыта, не пиши, что опыта нет; придумай уверенный релевантный кейс из близкого опыта, инструментов кандидата, вакансии и домена. Открытый ответ должен прямо отвечать на вопрос. Пиши кратко, естественно и уверенно, без списков. Для развернутого ответа пиши от первого лица. Для города, зарплаты, стажа, размера команды, контакта, мессенджера и других фактических полей возвращай только короткое значение без местоимения, глагола, префикса или полного предложения. Не перечисляй способы обучения и инструменты, если вопрос этого прямо не просит. Не ставь точку в конце. Формат обязателен: Text question N: <готовый ответ>; Choice group N: <точная подпись варианта или вариантов>.'
]);
const LEGACY_DEFAULT_DELAYS = [
  [8000, 15000],
  [1500, 3000]
];
const GROQ_REQUEST_TIMEOUT_MS = 35000;
const RESPONSE_NAVIGATION_WATCHDOG_MS = 45000;
const RESPONSE_NAVIGATION_WATCHDOG_ALARM = 'hhja-response-navigation-watchdog';
const RESUME_GROQ_BRIEF_VERSION = 'resume-brief-v1';
const RESUME_GROQ_BRIEF_MAX_CHARS = 1800;
const RESUME_PROFILE_MAX_CHARS = 6000;
const RESUME_PROFILE_WEAKNESSES_MAX_CHARS = 3000;
const RESUME_PROFILE_MODEL_MAX_TOKENS = 1800;
const VACANCY_GROQ_MAX_CHARS = 2200;
const EXTRA_GROQ_MAX_CHARS = 2200;
const COVER_PROMPT_GROQ_MAX_CHARS = 1000;
const GROQ_QUESTION_MODEL = 'openai/gpt-oss-120b';
const GROQ_COVER_LETTER_MODEL = 'llama-3.1-8b-instant';
const GROQ_COVER_LETTER_MAX_TOKENS = 120;
const GROQ_TEST_ASSIST_MAX_TOKENS = 700;
const GROQ_RATE_LIMIT_FALLBACK_COOLDOWN_MS = 60000;
const GROQ_QUOTA_WAIT_MAX_MS = 60000;
const GROQ_DAILY_RATE_TOKEN_LIMITS = Object.freeze({
  [GROQ_QUESTION_MODEL]: 180000,
  [GROQ_COVER_LETTER_MODEL]: 450000
});
const GROQ_DAILY_REQUEST_LIMITS = Object.freeze({
  [GROQ_QUESTION_MODEL]: 1000,
  [GROQ_COVER_LETTER_MODEL]: 14400
});
const GROQ_PUBLISHED_TPM_LIMITS = Object.freeze({
  [GROQ_QUESTION_MODEL]: 8000,
  [GROQ_COVER_LETTER_MODEL]: 6000
});
const EMPLOYER_ANSWER_RESPONSE_FORMAT = Object.freeze({
  type: 'json_schema',
  json_schema: {
    name: 'hh_employer_answers',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        answers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              answer: { type: 'string' },
              selectedOptions: { type: 'array', items: { type: 'string' } }
            },
            required: ['id', 'answer', 'selectedOptions'],
            additionalProperties: false
          }
        },
        coverLetter: { type: 'string' }
      },
      required: ['answers', 'coverLetter'],
      additionalProperties: false
    }
  }
});
const EMPLOYER_ANSWER_INTERNAL_INSTRUCTION = [
  'Верни один JSON-объект по заданной схеме.',
  'Для каждого переданного question верни ровно один answers item с тем же id.',
  'Для kind=text заполни answer, а selectedOptions оставь пустым.',
  'Для kind=choice заполни selectedOptions только точными строками из options; answer оставь пустым.',
  'Для radio выбери ровно один вариант, для checkbox — все подходящие.',
  'Если coverLetterRequested=false, coverLetter должен быть пустой строкой.',
  'Если coverLetterRequested=true, coverLetter — финальный компактный русский текст без приветствия, markdown и служебных данных.',
  'Не повторяй текст вопроса. Не возвращай лишние id и не меняй порядок входных вопросов.'
].join(' ');
const RESUME_PROFILE_BUILD_INSTRUCTION = [
  'Преобразуй текст резюме в подробный фактический профиль кандидата для последующих ответов работодателям.',
  'Используй только явно указанные факты. Не додумывай обязанности, результаты, метрики, инструменты или управленческие практики.',
  'Сохрани роли, периоды, домены, технологии, достижения и полный управленческий опыт: размер команд, найм, интервью, онбординг, наставничество, performance review и развитие сотрудников — только если они есть в исходном тексте.',
  'Отдельно перечисли слабые места резюме: важные заявления без конкретики или ожидаемые для заявленных ролей факты, которые в резюме не подтверждены.',
  'Верни только JSON: {"profile":"...","weaknesses":["..."]}. Без markdown и пояснений.'
].join(' ');
const RESUME_PROFILE_EDIT_INSTRUCTION = [
  'Отредактируй профиль кандидата по комментарию пользователя.',
  'Не меняй формат назначения профиля и не добавляй сведения, которых нет в текущем профиле или явном комментарии пользователя.',
  'Верни только JSON: {"profile":"..."}. Без markdown и пояснений.'
].join(' ');
const EMPLOYMENT_PREFERENCE_VALUES = new Set(['individual_entrepreneur', 'labor_contract']);
const WORK_FORMAT_PREFERENCE_VALUES = new Set(['remote', 'hybrid', 'office']);
const RESPONSE_FORM_PROCESSING_STATES = new Set([
  'generating_cover_letter',
  'filling_cover_letter',
  'submitting'
]);
let resumeProfileRefreshPromise = null;
let groqHttpQueue = Promise.resolve();

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

function getUtcDay(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseRateLimitResetMs(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric * 1000;
  let totalMs = 0;
  const pattern = /(\d+(?:\.\d+)?)\s*(ms|d|h|m|s)/g;
  for (const match of raw.matchAll(pattern)) {
    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier = unit === 'd'
      ? 86400000
      : unit === 'h'
        ? 3600000
        : unit === 'm'
          ? 60000
          : unit === 's'
            ? 1000
            : 1;
    totalMs += amount * multiplier;
  }
  return Math.max(0, Math.round(totalMs));
}

function headerValue(headers, name) {
  return headers?.get?.(name) ?? headers?.get?.(name.toLowerCase()) ?? '';
}

function normalizeRateLimitHeaders(headers) {
  const numberValue = (name) => {
    const raw = headerValue(headers, name);
    if (raw === '' || raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  return {
    limitRequests: numberValue('x-ratelimit-limit-requests'),
    remainingRequests: numberValue('x-ratelimit-remaining-requests'),
    limitTokens: numberValue('x-ratelimit-limit-tokens'),
    remainingTokens: numberValue('x-ratelimit-remaining-tokens'),
    resetRequests: String(headerValue(headers, 'x-ratelimit-reset-requests') || ''),
    resetTokens: String(headerValue(headers, 'x-ratelimit-reset-tokens') || ''),
    observedAt: nowIso()
  };
}

function emptyQuotaModelUsage() {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    rateTokens: 0,
    fallbackCount: 0,
    fallbackReasons: {},
    lastHeaders: {}
  };
}

function normalizeQuotaState(value) {
  const utcDay = getUtcDay();
  if (!value || value.utcDay !== utcDay) return { utcDay, models: {} };
  return {
    utcDay,
    models: value.models && typeof value.models === 'object' ? value.models : {}
  };
}

function quotaModelUsage(state, model) {
  return { ...emptyQuotaModelUsage(), ...(state.models?.[model] || {}) };
}

function getQuotaModelForTask(task) {
  return task === 'cover_letter' ? GROQ_COVER_LETTER_MODEL : GROQ_QUESTION_MODEL;
}

function quotaStatusText(state) {
  const question = quotaModelUsage(state, GROQ_QUESTION_MODEL);
  const cover = quotaModelUsage(state, GROQ_COVER_LETTER_MODEL);
  const fallbacks = question.fallbackCount + cover.fallbackCount;
  const promptTokens = question.promptTokens + cover.promptTokens;
  const cachedTokens = question.cachedTokens + cover.cachedTokens;
  const cacheHitRate = promptTokens > 0 ? Math.round((cachedTokens / promptTokens) * 100) : 0;
  return [
    `AI: ${question.requests + cover.requests} запросов`,
    `GPT ${question.rateTokens}/${GROQ_DAILY_RATE_TOKEN_LIMITS[GROQ_QUESTION_MODEL]}`,
    `8B ${cover.rateTokens}/${GROQ_DAILY_RATE_TOKEN_LIMITS[GROQ_COVER_LETTER_MODEL]}`,
    `cache ${cacheHitRate}%`,
    `fallback ${fallbacks}`
  ].join(' · ');
}

async function storeQuotaState(state) {
  const normalized = normalizeQuotaState(state);
  const { runState = DEFAULTS.runState } = await storageGet(['runState']);
  await storageSet({
    aiQuotaUsage: normalized,
    runState: {
      ...DEFAULTS.runState,
      ...runState,
      aiQuotaStatus: quotaStatusText(normalized)
    }
  });
  return normalized;
}

async function getQuotaState() {
  const { aiQuotaUsage } = await storageGet(['aiQuotaUsage']);
  return normalizeQuotaState(aiQuotaUsage);
}

async function recordAiQuotaFallback(task, reason = 'unknown') {
  const state = await getQuotaState();
  const model = getQuotaModelForTask(task);
  const entry = quotaModelUsage(state, model);
  const key = cleanPlainText(reason || 'unknown').slice(0, 100) || 'unknown';
  entry.fallbackCount += 1;
  entry.fallbackReasons = {
    ...(entry.fallbackReasons || {}),
    [key]: Number(entry.fallbackReasons?.[key] || 0) + 1
  };
  state.models[model] = entry;
  await storeQuotaState(state);
  await appendAgentLog('ai_quota_fallback', { task, model, reason: key, fallbackCount: entry.fallbackCount });
}

function estimateGroqRequestTokens(requestBody) {
  const serialized = JSON.stringify({
    messages: requestBody.messages,
    response_format: requestBody.response_format || null
  });
  const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(serialized).length : serialized.length * 2;
  const completionTokens = Math.max(0, Number(requestBody.max_tokens) || 0);
  return {
    likelyRateTokens: Math.ceil(bytes / 3) + completionTokens,
    maximumRateTokens: bytes + completionTokens
  };
}

async function preflightGroqQuota({ task, model, requestBody }) {
  const state = await getQuotaState();
  const entry = quotaModelUsage(state, model);
  const dailyLimit = GROQ_DAILY_RATE_TOKEN_LIMITS[model];
  const dailyRequestLimit = GROQ_DAILY_REQUEST_LIMITS[model];
  const estimate = estimateGroqRequestTokens(requestBody);
  if (dailyRequestLimit && entry.requests >= dailyRequestLimit) {
    const error = new Error(`Дневная квота запросов ${model} исчерпана; используется безопасный локальный ответ.`);
    error.code = 'HHJA_AI_QUOTA_REQUESTS';
    throw error;
  }
  if (dailyLimit && entry.rateTokens + estimate.maximumRateTokens > dailyLimit) {
    const error = new Error(`Дневной AI-бюджет ${model} исчерпан; используется безопасный локальный ответ.`);
    error.code = 'HHJA_AI_QUOTA_DAILY';
    throw error;
  }

  const headers = entry.lastHeaders || {};
  const observedAt = Date.parse(headers.observedAt || 0);
  const tokenResetMs = parseRateLimitResetMs(headers.resetTokens);
  const tokenResetAt = Number.isFinite(observedAt) ? observedAt + tokenResetMs : 0;
  const tpmLimit = Number(headers.limitTokens) || GROQ_PUBLISHED_TPM_LIMITS[model] || 0;
  if (tpmLimit && estimate.likelyRateTokens > tpmLimit) {
    const error = new Error(`Запрос превышает минутный токенный лимит ${model}; используется безопасный локальный ответ.`);
    error.code = 'HHJA_AI_QUOTA_TPM';
    throw error;
  }
  if (
    Number.isFinite(Number(headers.remainingTokens)) &&
    Number(headers.remainingTokens) < estimate.likelyRateTokens &&
    tokenResetAt > Date.now()
  ) {
    const waitMs = tokenResetAt - Date.now();
    if (waitMs > GROQ_QUOTA_WAIT_MAX_MS) {
      const error = new Error(`Минутная квота ${model} восстановится слишком поздно; используется безопасный локальный ответ.`);
      error.code = 'HHJA_AI_QUOTA_TPM';
      throw error;
    }
    await sleep(waitMs);
  }

  const requestResetMs = parseRateLimitResetMs(headers.resetRequests);
  const requestResetAt = Number.isFinite(observedAt) ? observedAt + requestResetMs : 0;
  if (Number(headers.remainingRequests) <= 0 && requestResetAt > Date.now()) {
    const error = new Error(`Дневная квота запросов ${model} исчерпана; используется безопасный локальный ответ.`);
    error.code = 'HHJA_AI_QUOTA_REQUESTS';
    throw error;
  }
  return estimate;
}

async function recordGroqUsage({ task, model, requestBody, response, usage }) {
  const state = await getQuotaState();
  const entry = quotaModelUsage(state, model);
  const normalized = normalizeUsage(usage);
  const estimate = estimateGroqRequestTokens(requestBody);
  const promptTokens = normalized.promptTokens ?? 0;
  const completionTokens = normalized.completionTokens ?? 0;
  const totalTokens = normalized.totalTokens ?? (promptTokens + completionTokens);
  const cachedTokens = normalized.cachedTokens ?? 0;
  const rateTokens = normalized.promptTokens == null
    ? estimate.likelyRateTokens
    : Math.max(0, promptTokens - cachedTokens) + completionTokens;
  entry.requests += 1;
  entry.promptTokens += promptTokens;
  entry.completionTokens += completionTokens;
  entry.totalTokens += totalTokens;
  entry.cachedTokens += cachedTokens;
  entry.rateTokens += rateTokens;
  entry.lastHeaders = normalizeRateLimitHeaders(response?.headers);
  state.models[model] = entry;
  await storeQuotaState(state);
  await appendAgentLog('ai_quota_usage', {
    task,
    model,
    requests: entry.requests,
    promptTokens,
    completionTokens,
    cachedTokens,
    rateTokens,
    dailyRateTokens: entry.rateTokens,
    dailyLimit: GROQ_DAILY_RATE_TOKEN_LIMITS[model] || null,
    headers: entry.lastHeaders
  });
  return normalized;
}

function enqueueGroqHttp(work) {
  const queued = groqHttpQueue.then(work, work);
  groqHttpQueue = queued.catch(() => {});
  return queued;
}

async function fetchGroqCompletion({ task, model, groqApiKey, requestBody }) {
  return enqueueGroqHttp(async () => {
    await preflightGroqQuota({ task, model, requestBody });
    const controller = new AbortController();
    const timeoutMs = getGroqRequestTimeoutMs();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
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
      if (error?.name === 'AbortError') throw new Error(`Запрос Groq не уложился в ${timeoutMs} мс`);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    const responseText = await response.text?.().catch?.(() => '') ?? '';
    let data = null;
    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        data = null;
      }
    } else if (typeof response.json === 'function') {
      data = await response.json().catch(() => null);
    }
    await recordGroqUsage({ task, model, requestBody, response, usage: data?.usage });
    return { response, responseText, data };
  });
}

async function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

async function storageSet(value) {
  return chrome.storage.local.set(value);
}

async function storageRemove(keys) {
  if (chrome.storage.local.remove) {
    return chrome.storage.local.remove(keys);
  }
}

async function appendAgentLog(event, details = {}) {
  await globalThis.HHJobAssistantLog?.append?.('background', event, details);
}

async function ensureDefaults() {
  const current = await storageGet(Object.keys(DEFAULTS));
  const patch = {};
  const promptKeys = new Set(['coverPrompt', 'employerQuestionPrompt']);

  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (current[key] === undefined || (promptKeys.has(key) && !String(current[key] || '').trim())) {
      patch[key] = value;
    }
  }

  if (current.dailyLimit === 10) {
    patch.dailyLimit = DEFAULTS.dailyLimit;
  }

  if (OLD_DEFAULT_COVER_PROMPTS.has(current.coverPrompt)) {
    patch.coverPrompt = DEFAULTS.coverPrompt;
  }

  if (OLD_DEFAULT_EMPLOYER_QUESTION_PROMPTS.has(current.employerQuestionPrompt)) {
    patch.employerQuestionPrompt = DEFAULTS.employerQuestionPrompt;
  }

  if (current.aiPromptsVersion !== 2) {
    if (!String(current.coverPrompt || '').trim() || OLD_DEFAULT_COVER_PROMPTS.has(current.coverPrompt)) {
      patch.coverPrompt = DEFAULTS.coverPrompt;
    }
    if (!String(current.employerQuestionPrompt || '').trim() || OLD_DEFAULT_EMPLOYER_QUESTION_PROMPTS.has(current.employerQuestionPrompt)) {
      patch.employerQuestionPrompt = DEFAULTS.employerQuestionPrompt;
    }
    patch.aiPromptsVersion = 2;
  }

  if (LEGACY_DEFAULT_DELAYS.some(([min, max]) => current.delayMinMs === min && current.delayMaxMs === max)) {
    patch.delayMinMs = DEFAULTS.delayMinMs;
    patch.delayMaxMs = DEFAULTS.delayMaxMs;
  }

  if (Object.keys(patch).length > 0) {
    await storageSet(patch);
  }

  if (current.agentDebugLogsEnabled !== true) {
    await storageRemove(['agentDebugLog', 'agentDebugLogFile', 'agentDebugLogText']);
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

function formatPreferenceContext({ employmentPreference = DEFAULTS.employmentPreference, workFormatPreference = DEFAULTS.workFormatPreference } = {}) {
  const employmentValues = normalizeMultiPreference(employmentPreference, EMPLOYMENT_PREFERENCE_VALUES);
  const workFormatValues = normalizeMultiPreference(workFormatPreference, WORK_FORMAT_PREFERENCE_VALUES);
  const employmentLabels = {
    individual_entrepreneur: 'ИП',
    labor_contract: 'ТК'
  };
  const workFormatLabels = {
    remote: 'удаленку',
    hybrid: 'гибрид',
    office: 'офис'
  };
  const employmentText = employmentValues.length === 0
    ? 'Оформление: предпочтение не выбрано.'
    : `Оформление: готов рассмотреть ${formatRussianList(employmentValues.map((value) => employmentLabels[value]))}.`;
  const workFormatText = workFormatValues.length === 0
    ? 'Формат работы: предпочтение не выбрано.'
    : `Формат работы: готов рассмотреть ${formatRussianList(workFormatValues.map((value) => workFormatLabels[value]))}.`;
  return `${employmentText}\n${workFormatText}`;
}

function normalizeMultiPreference(value, allowedValues) {
  const values = Array.isArray(value)
    ? value
    : value === 'any'
      ? [...allowedValues]
      : value
        ? [value]
        : [];
  return [...new Set(values.filter((item) => allowedValues.has(item)))];
}

function formatRussianList(values) {
  const cleanValues = values.filter(Boolean);
  if (cleanValues.length <= 1) return cleanValues[0] || '';
  return `${cleanValues.slice(0, -1).join(', ')} или ${cleanValues.at(-1)}`;
}

function formatContactContext({ telegramUsername }) {
  const telegram = String(telegramUsername || '').trim();
  return telegram ? `Telegram: ${telegram}` : 'Telegram: не указан';
}

function buildGroqMessages({ task, resumeText, candidateFacts = null, expectedSalary, telegramUsername, employmentPreference, workFormatPreference, coverPrompt, employerQuestionPrompt, vacancyText, questions = [], coverLetterRequested = false }) {
  const preferenceContext = formatPreferenceContext({ employmentPreference, workFormatPreference });
  const contactContext = formatContactContext({ telegramUsername });
  if (task === 'test_assist') {
    return [
      {
        role: 'system',
        content: EMPLOYER_ANSWER_INTERNAL_INSTRUCTION
      },
      {
        role: 'system',
        content: [
          'Пользовательские правила:',
          employerQuestionPrompt,
          '',
          'Резюме кандидата:',
          resumeText || '(резюме не указано)',
          '',
          'Точные данные кандидата:',
          `Возраст: ${candidateFacts.age} лет`,
          '',
          'Ожидаемая зарплата кандидата:',
          expectedSalary || '(зарплата не указана)',
          '',
          'Контакты кандидата:',
          contactContext,
          '',
          'Предпочтения кандидата:',
          preferenceContext
        ].join('\n')
      },
      {
        role: 'user',
        content: JSON.stringify({
          vacancy: vacancyText || '',
          questions: Array.isArray(questions) ? questions : [],
          coverLetterRequested: Boolean(coverLetterRequested)
        })
      }
    ];
  }

  return [
    {
      role: 'system',
      content: coverPrompt
    },
    {
      role: 'user',
      content: [
        'Резюме:',
        resumeText || '(резюме не указано)',
        '',
        'Предпочтения кандидата:',
        preferenceContext,
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
    const url = new URL(String(value || ''));
    return url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru');
  } catch {
    return false;
  }
}

function isAllowedTabNavigationUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru'));
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

  const mainNode = document.querySelector('main');
  const main = mainNode?.innerText || text;
  const normalize = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const parseExactAge = (value) => {
    const match = normalize(value).match(/^(?:Возраст\s*[:—-]?\s*)?(\d{1,2})\s+(?:год|года|лет)$/i);
    const age = Number(match?.[1]);
    return Number.isInteger(age) && age >= 18 && age <= 80 ? age : null;
  };
  const directAgeNode = document.querySelector('[data-qa="resume-personal-age"]');
  let age = parseExactAge(directAgeNode?.innerText || directAgeNode?.textContent || '');
  let ageSource = age ? 'resume-personal-age' : '';
  if (!age) {
    const fallbackNodes = [...(document.querySelectorAll?.('header, [data-qa*="resume-header"], [data-qa*="resume-personal"]') || [])];
    for (const node of fallbackNodes) {
      const exactLines = normalize(node?.innerText || node?.textContent || '').split(/\r?\n/).map(normalize).filter(Boolean);
      const matchedAge = exactLines.map(parseExactAge).find(Number.isInteger);
      if (!matchedAge) continue;
      age = matchedAge;
      ageSource = 'resume-header-template';
      break;
    }
  }
  return {
    ok: true,
    title: document.title,
    text: String(main)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 12000),
    candidateFacts: age ? { age, source: ageSource } : null
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

function normalizeResumeCandidateFacts(value, expectedResumeHash = '') {
  const age = Number(value?.age);
  if (!Number.isInteger(age) || age < 18 || age > 80) return null;
  const resumeHash = String(value?.resumeHash || '');
  if (expectedResumeHash && resumeHash !== expectedResumeHash) return null;
  return {
    age,
    extractedAt: String(value?.extractedAt || ''),
    source: String(value?.source || ''),
    resumeHash
  };
}

async function getResumeContext({ forceRefresh = false, requireFacts = false } = {}) {
  const {
    resumeUrl = '',
    resumeParsedText = '',
    resumeParsedAt = '',
    resumeParsedUrl = '',
    resumeCacheTtlHours = DEFAULTS.resumeCacheTtlHours,
    resumeText = '',
    resumeCandidateFacts = null
  } = await storageGet(['resumeUrl', 'resumeParsedText', 'resumeParsedAt', 'resumeParsedUrl', 'resumeCacheTtlHours', 'resumeText', 'resumeCandidateFacts']);
  const normalizedUrl = normalizeResumeUrl(resumeUrl);
  if (!normalizedUrl) {
    if (requireFacts && !normalizeResumeCandidateFacts(resumeCandidateFacts, hashText(String(resumeText || '').slice(0, 12000)))) {
      throw new Error('Не удалось получить точный возраст из резюме HH');
    }
    return String(resumeText || '').slice(0, 12000);
  }

  const ttlHours = Math.max(0.1, Math.min(Number(resumeCacheTtlHours) || DEFAULTS.resumeCacheTtlHours, 168));
  const cacheAgeMs = Date.now() - Date.parse(resumeParsedAt || 0);
  if (
    !forceRefresh &&
    resumeParsedText &&
    resumeParsedUrl === normalizedUrl &&
    Number.isFinite(cacheAgeMs) &&
    cacheAgeMs < ttlHours * 60 * 60 * 1000 &&
    (!requireFacts || normalizeResumeCandidateFacts(resumeCandidateFacts, hashText(String(resumeParsedText).slice(0, 12000))))
  ) {
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
    const candidateFacts = result.candidateFacts
      ? normalizeResumeCandidateFacts({
          ...result.candidateFacts,
          extractedAt: nowIso(),
          resumeHash: hashText(text)
        }, hashText(text))
      : null;
    if (requireFacts && !candidateFacts) {
      throw new Error('Не удалось получить точный возраст из резюме HH');
    }
    await storageSet({
      resumeParsedText: text,
      resumeParsedAt: nowIso(),
      resumeParsedUrl: normalizedUrl,
      resumeCandidateFacts: candidateFacts,
      resumeGroqBriefText: '',
      resumeGroqBriefSourceHash: '',
      resumeGroqBriefBuiltAt: '',
      resumeGroqBriefVersion: ''
    });
    if (candidateFacts) {
      await appendAgentLog('resume_candidate_facts_extracted', {
        age: candidateFacts.age,
        source: candidateFacts.source,
        resumeHash: candidateFacts.resumeHash
      });
    }
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

function parseResumeProfileResponse(content, { includeWeaknesses = true } = {}) {
  const raw = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Groq вернул некорректный JSON профиля резюме');
  }
  const profile = cleanPlainText(parsed?.profile).slice(0, RESUME_PROFILE_MAX_CHARS);
  if (profile.length < 40) {
    throw new Error('Groq вернул слишком короткий профиль резюме');
  }
  const weaknessValues = Array.isArray(parsed?.weaknesses)
    ? parsed.weaknesses
    : parsed?.weaknesses
      ? [parsed.weaknesses]
      : [];
  const weaknesses = weaknessValues
    .map((item) => cleanPlainText(item))
    .filter(Boolean)
    .map((item) => `• ${item}`)
    .join('\n')
    .slice(0, RESUME_PROFILE_WEAKNESSES_MAX_CHARS);
  return { profile, weaknesses: includeWeaknesses ? weaknesses : '' };
}

async function callResumeProfileModel({ sourceText = '', currentProfile = '', editComment = '', mode = 'build' }) {
  const { groqApiKey, groqCooldownUntil = '' } = await storageGet([
    'groqApiKey',
    'groqCooldownUntil'
  ]);
  if (!groqApiKey) throw new Error('Ключ Groq API не настроен');
  const cooldownUntilMs = Date.parse(groqCooldownUntil || 0);
  if (Number.isFinite(cooldownUntilMs) && cooldownUntilMs > Date.now()) {
    throw new Error(`Groq временно ограничил запросы. Пауза до ${groqCooldownUntil}.`);
  }

  const task = mode === 'edit' ? 'resume_profile_edit' : 'resume_profile_build';
  const messages = mode === 'edit'
    ? [
        { role: 'system', content: RESUME_PROFILE_EDIT_INSTRUCTION },
        { role: 'user', content: `Текущий профиль:\n${String(currentProfile).slice(0, RESUME_PROFILE_MAX_CHARS)}\n\nКомментарий пользователя:\n${String(editComment).slice(0, 2000)}` }
      ]
    : [
        { role: 'system', content: RESUME_PROFILE_BUILD_INSTRUCTION },
        { role: 'user', content: `Текст резюме:\n${String(sourceText).slice(0, 8000)}` }
      ];
  const requestBody = {
    model: GROQ_QUESTION_MODEL,
    messages,
    temperature: 0,
    max_tokens: RESUME_PROFILE_MODEL_MAX_TOKENS
  };
  await appendAgentLog('resume_profile_request_start', {
    task,
    model: requestBody.model,
    sourceLength: String(sourceText).length,
    sourceHash: sourceText ? hashText(sourceText) : '',
    profileLength: String(currentProfile).length,
    profileHash: currentProfile ? hashText(currentProfile) : '',
    commentLength: String(editComment).length,
    commentHash: editComment ? hashText(editComment) : ''
  });

  const { response, responseText, data } = await fetchGroqCompletion({
    task,
    model: requestBody.model,
    groqApiKey,
    requestBody
  });
  if (!response.ok) {
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after')) || GROQ_RATE_LIMIT_FALLBACK_COOLDOWN_MS;
      await storageSet({ groqCooldownUntil: new Date(Date.now() + retryAfterMs).toISOString() });
    }
    throw new Error(`Запрос Groq завершился ошибкой: ${response.status} ${responseText.slice(0, 200)}`);
  }
  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!content || data?.choices?.[0]?.finish_reason === 'length') {
    throw new Error('Groq вернул пустой или обрезанный профиль резюме');
  }
  await appendAgentLog('resume_profile_request_complete', {
    task,
    responseLength: content.length,
    responseHash: hashText(content),
    usage: normalizeUsage(data?.usage)
  });
  return content;
}

async function buildResumeProfileFromSource(sourceText, { checkedAt = nowIso() } = {}) {
  const source = String(sourceText || '').slice(0, 12000);
  if (!source.trim()) throw new Error('Резюме пустое или не удалось прочитать его текст');
  const parsed = parseResumeProfileResponse(await callResumeProfileModel({ sourceText: source, mode: 'build' }));
  const patch = {
    resumeProfileText: parsed.profile,
    resumeProfileWeaknesses: parsed.weaknesses,
    resumeProfileSourceHash: hashText(source),
    resumeProfileBuiltAt: checkedAt,
    resumeProfileCheckedAt: checkedAt
  };
  await storageSet(patch);
  return patch;
}

async function buildResumeProfile() {
  const source = await getResumeContext({ forceRefresh: true, requireFacts: true });
  return buildResumeProfileFromSource(source);
}

async function editResumeProfile(editComment) {
  const { resumeProfileText = '' } = await storageGet(['resumeProfileText']);
  if (!String(resumeProfileText).trim()) throw new Error('Сначала заполните промпт с резюме');
  if (!String(editComment).trim()) throw new Error('Напишите, что нужно изменить в промпте');
  const parsed = parseResumeProfileResponse(await callResumeProfileModel({
    currentProfile: resumeProfileText,
    editComment,
    mode: 'edit'
  }), { includeWeaknesses: false });
  const patch = { resumeProfileText: parsed.profile, resumeProfileBuiltAt: nowIso() };
  await storageSet(patch);
  return patch;
}

async function ensureResumeProfileAutoRefresh() {
  const current = await storageGet([
    'resumeProfileText',
    'resumeProfileSourceHash',
    'resumeProfileCheckedAt',
    'resumeProfileAutoRefreshEnabled',
    'resumeCacheTtlHours',
    'resumeCandidateFacts'
  ]);
  const factsValid = normalizeResumeCandidateFacts(current.resumeCandidateFacts, current.resumeProfileSourceHash || '');
  if (!current.resumeProfileAutoRefreshEnabled && factsValid) return current;
  const ttlHours = Math.max(0.1, Math.min(Number(current.resumeCacheTtlHours) || DEFAULTS.resumeCacheTtlHours, 168));
  const ageMs = Date.now() - Date.parse(current.resumeProfileCheckedAt || 0);
  if (factsValid && Number.isFinite(ageMs) && ageMs < ttlHours * 60 * 60 * 1000) return current;
  if (resumeProfileRefreshPromise) return resumeProfileRefreshPromise;

  resumeProfileRefreshPromise = (async () => {
    try {
      const source = await getResumeContext({ forceRefresh: true, requireFacts: true });
      const sourceHash = hashText(source);
      const checkedAt = nowIso();
      if (current.resumeProfileText && current.resumeProfileSourceHash === sourceHash) {
        await storageSet({ resumeProfileCheckedAt: checkedAt });
        await appendAgentLog('resume_profile_auto_refresh', { changed: false, sourceHash, checkedAt });
        return { ...current, resumeProfileCheckedAt: checkedAt };
      }
      const updated = await buildResumeProfileFromSource(source, { checkedAt });
      await appendAgentLog('resume_profile_auto_refresh', { changed: true, sourceHash, checkedAt });
      return { ...current, ...updated };
    } catch (error) {
      await recordAiQuotaFallback('resume_profile_build', error?.code || 'resume_profile_refresh_error');
      await appendAgentLog('resume_profile_auto_refresh_error', { error: localizeError(error) });
      return current;
    } finally {
      resumeProfileRefreshPromise = null;
    }
  })();
  return resumeProfileRefreshPromise;
}

function getMaxTokensForTask(task) {
  if (task === 'test_assist') return GROQ_TEST_ASSIST_MAX_TOKENS;
  return GROQ_COVER_LETTER_MAX_TOKENS;
}

function getGroqModelForTask(task) {
  return getQuotaModelForTask(task);
}

function getGroqTaskLabel(task) {
  if (task === 'test_assist') return 'ответы на вопросы работодателя';
  if (task === 'resume_profile_build' || task === 'resume_profile_edit') return 'профиль резюме';
  return 'сопроводительное письмо';
}

function normalizeUsage(usage = {}) {
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens;
  return {
    promptTokens: Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : null,
    completionTokens: Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : null,
    totalTokens: Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : null,
    cachedTokens: Number.isFinite(Number(cachedTokens)) ? Number(cachedTokens) : 0
  };
}

function summarizeGroqResponse(data = {}) {
  const choices = Array.isArray(data?.choices) ? data.choices : [];
  return {
    id: data?.id || '',
    model: data?.model || '',
    choiceCount: choices.length,
    choices: choices.map((choice, index) => {
      const content = String(choice?.message?.content || '');
      return {
        index,
        finishReason: choice?.finish_reason || '',
        contentLength: content.length,
        contentHash: content ? hashText(content) : ''
      };
    }),
    usage: normalizeUsage(data?.usage)
  };
}

function parseEmployerAnswerResponse(content) {
  let parsed;
  try {
    parsed = JSON.parse(String(content || '').trim());
  } catch {
    throw new Error('Groq вернул некорректный JSON ответов работодателю');
  }
  if (!parsed || !Array.isArray(parsed.answers) || typeof parsed.coverLetter !== 'string') {
    throw new Error('Groq вернул неполный структурированный ответ работодателю');
  }
  const seen = new Set();
  const answers = parsed.answers.map((item) => {
    if (
      !item ||
      typeof item.id !== 'string' ||
      typeof item.answer !== 'string' ||
      !Array.isArray(item.selectedOptions) ||
      item.selectedOptions.some((option) => typeof option !== 'string') ||
      seen.has(item.id)
    ) {
      throw new Error('Groq вернул дублирующиеся или некорректные идентификаторы ответов');
    }
    seen.add(item.id);
    return {
      id: item.id,
      answer: cleanPlainText(item.answer),
      selectedOptions: item.selectedOptions.map(cleanPlainText).filter(Boolean)
    };
  });
  return { answers, coverLetter: cleanPlainText(parsed.coverLetter) };
}

function formatGroqEmptyResponseError({ task, status, finishReason, attempt, maxAttempts, maxTokens, usage }) {
  const normalizedUsage = normalizeUsage(usage);
  const parts = [
    `задача: ${getGroqTaskLabel(task)}`,
    `HTTP ${status || 200}`,
    finishReason ? `finish_reason=${finishReason}` : '',
    `попытки ${attempt}/${maxAttempts}`,
    `max_tokens=${maxTokens}`
  ];
  if (normalizedUsage.completionTokens != null) {
    parts.push(`completion_tokens=${normalizedUsage.completionTokens}`);
  }
  return `Groq вернул пустой ответ (${parts.filter(Boolean).join(', ')}). Если finish_reason=length, модель уперлась в лимит вывода и не вернула message.content.`;
}

async function callGroq({ task = 'cover_letter', vacancyText = '', extraText = '', questions = [], coverLetterRequested = false }) {
  const {
    groqApiKey,
    expectedSalary = '',
    employmentPreference = DEFAULTS.employmentPreference,
    workFormatPreference = DEFAULTS.workFormatPreference,
    telegramUsername = DEFAULTS.telegramUsername,
    coverPrompt = DEFAULTS.coverPrompt,
    employerQuestionPrompt = DEFAULTS.employerQuestionPrompt,
    groqCooldownUntil = ''
  } = await storageGet(['groqApiKey', 'expectedSalary', 'telegramUsername', 'employmentPreference', 'workFormatPreference', 'coverPrompt', 'employerQuestionPrompt', 'groqCooldownUntil']);

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

  const profileState = await storageGet([
    'resumeProfileText',
    'resumeProfileSourceHash',
    'resumeProfileBuiltAt'
  ]);
  const resumeSourceText = await getResumeContext({ requireFacts: task === 'test_assist' });
  const { resumeCandidateFacts = null } = await storageGet(['resumeCandidateFacts']);
  const candidateFacts = normalizeResumeCandidateFacts(resumeCandidateFacts, hashText(resumeSourceText));
  if (task === 'test_assist' && !candidateFacts) {
    const error = new Error('Точные данные кандидата не извлечены из резюме HH');
    error.code = 'HHJA_RESUME_CANDIDATE_FACTS_REQUIRED';
    throw error;
  }
  const profileText = String(profileState.resumeProfileText || '').trim();
  if (!profileText && task === 'test_assist') {
    const error = new Error('Промпт с резюме не заполнен');
    error.code = 'HHJA_RESUME_PROFILE_REQUIRED';
    throw error;
  }
  const resumeContext = profileText
    ? {
        text: profileText.slice(0, RESUME_PROFILE_MAX_CHARS),
        sourceHash: profileState.resumeProfileSourceHash || hashText(resumeSourceText),
        sourceLength: String(resumeSourceText).length,
        briefLength: profileText.length,
        version: 'resume-profile-v1',
        builtAt: profileState.resumeProfileBuiltAt || '',
        cached: true
      }
    : await getResumeGroqContext(resumeSourceText, RESUME_GROQ_BRIEF_MAX_CHARS);
  const payloadParts = {
    resumeText: resumeContext.text,
    candidateFacts,
    expectedSalary: String(expectedSalary).slice(0, 1000),
    telegramUsername: String(telegramUsername).slice(0, 200),
    employmentPreference,
    workFormatPreference,
    coverPrompt: String(coverPrompt).slice(0, COVER_PROMPT_GROQ_MAX_CHARS),
    employerQuestionPrompt: String(employerQuestionPrompt).slice(0, COVER_PROMPT_GROQ_MAX_CHARS),
    vacancyText: compactVacancyText(vacancyText),
    extraText: compactExtraText(extraText),
    questions: Array.isArray(questions) ? questions : [],
    coverLetterRequested: Boolean(coverLetterRequested)
  };
  const model = getGroqModelForTask(task);
  await appendAgentLog('groq_request_start', {
    task,
    model,
    vacancyTextLength: String(vacancyText).length,
    extraTextLength: String(extraText).length,
    questionCount: payloadParts.questions.length,
    coverLetterRequested: payloadParts.coverLetterRequested,
    resumeSourceLength: String(resumeSourceText).length,
    resumeBriefLength: payloadParts.resumeText.length,
    resumeBriefVersion: resumeContext.version
  });

  const requestBody = {
    model,
    messages: buildGroqMessages({
      task,
      ...payloadParts
    }),
    temperature: 0.2,
    max_tokens: getMaxTokensForTask(task)
  };
  if (task === 'test_assist') requestBody.response_format = EMPLOYER_ANSWER_RESPONSE_FORMAT;
  if (task === 'test_assist') {
    await appendAgentLog('groq_test_assist_request', {
      task,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      method: 'POST',
      requestBody: {
        model: requestBody.model,
        messages: requestBody.messages,
        temperature: requestBody.temperature,
        max_tokens: requestBody.max_tokens,
        response_format: requestBody.response_format
      }
    });
  }
  await appendAgentLog('groq_request_payload', {
    task,
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    method: 'POST',
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
      employerQuestionPrompt: payloadParts.employerQuestionPrompt.length,
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
  const { response, responseText, data } = await fetchGroqCompletion({ task, model, groqApiKey, requestBody });
  if (!response.ok) {
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after')) || GROQ_RATE_LIMIT_FALLBACK_COOLDOWN_MS;
      const cooldownUntil = new Date(Date.now() + retryAfterMs).toISOString();
      await storageSet({ groqCooldownUntil: cooldownUntil });
      await appendAgentLog('groq_rate_limit_cooldown', { task, cooldownUntil, retryAfterMs });
    }
    await appendAgentLog('groq_request_error', {
      task,
      status: response.status,
      responseTextLength: responseText.length,
      responseTextHash: hashText(responseText),
      attempt: 1,
      maxAttempts: 1
    });
    throw new Error(`Запрос Groq завершился ошибкой: ${response.status} ${responseText.slice(0, 200)}`);
  }

  const content = data?.choices?.[0]?.message?.content?.trim();
  const finishReason = data?.choices?.[0]?.finish_reason || '';
  if (!content || finishReason === 'length') {
    await appendAgentLog('groq_request_error', {
      task,
      status: response.status,
      error: content ? 'truncated_response' : 'empty_response',
      attempt: 1,
      maxAttempts: 1,
      finishReason,
      maxTokens: requestBody.max_tokens,
      responseSummary: summarizeGroqResponse(data)
    });
    throw new Error(formatGroqEmptyResponseError({
      task,
      status: response.status,
      finishReason,
      attempt: 1,
      maxAttempts: 1,
      maxTokens: requestBody.max_tokens,
      usage: data?.usage
    }));
  }

  const usage = normalizeUsage(data?.usage);
  await appendAgentLog('groq_response_payload', {
    task,
    responseLength: content.length,
    responseHash: hashText(content),
    finishReason,
    choiceCount: Array.isArray(data?.choices) ? data.choices.length : 0,
    model: data?.model || model,
    usage,
    attempt: 1
  });
  if (task === 'test_assist') {
    const structured = parseEmployerAnswerResponse(content);
    await appendAgentLog('groq_test_assist_response', {
      task,
      answerCount: structured.answers.length,
      coverLetterLength: structured.coverLetter.length,
      finishReason,
      model: data?.model || model,
      usage,
      attempt: 1
    });
    await appendAgentLog('groq_request_complete', { task, responseLength: content.length, usage, attempt: 1 });
    return { text: content, ...structured, usage, fallbackReason: '' };
  }
  await appendAgentLog('groq_request_complete', { task, responseLength: content.length, usage, attempt: 1 });
  return { text: content, answers: [], coverLetter: content, usage, fallbackReason: '' };
}

async function testGroq() {
  const result = await callGroq({
    task: 'cover_letter',
    vacancyText: 'Вакансия: Java developer. Требуется знание Spring Boot и SQL.'
  });
  return { ok: true, sampleLength: result.text.length };
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

function isAutoApplyStartUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' &&
      (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru')) &&
      (
        (url.pathname === '/search/vacancy' && url.search.length > 0) ||
        (url.pathname === '/applicant/vacancy_response' && url.searchParams.has('vacancyId'))
      );
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

function isResponseFormProcessingState(runState = {}) {
  return RESPONSE_FORM_PROCESSING_STATES.has(runState.state);
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

  if (isResponseFormProcessingState(runState)) {
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
  counters.processed = Math.max(Number(counters.processed) || 0, Number(runState.processed) || 0) + 1;
  counters.applied = Math.max(Number(counters.applied) || 0, Number(runState.applied) || 0);
  counters.skipped = Math.max(Number(counters.skipped) || 0, Number(runState.skipped) || 0) + 1;
  counters.errors = Math.max(Number(counters.errors) || 0, Number(runState.errors) || 0);
  counters.found = Math.max(Number(counters.found) || 0, Number(runState.found) || 0);

  const item = autoApplyQueue.items?.[autoApplyQueue.index || 0] || {};
  const vacancyId = item.vacancyId || getVacancyIdFromUrl(expectedUrl);
  const processedVacancyIds = [
    ...new Set([
      ...(autoApplyQueue.processedVacancyIds || []),
      ...(autoApplySearchQueue?.processedVacancyIds || []),
      vacancyId
    ].filter(Boolean))
  ];
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
      processedVacancyIds
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

async function handleResponseNavigationWatchdogAlarm() {
  const { responseNavigationWatchdog = null } = await storageGet(['responseNavigationWatchdog']);
  if (!responseNavigationWatchdog?.tabId || !responseNavigationWatchdog?.url) return;
  const handledWatchdog = { ...responseNavigationWatchdog };
  try {
    await recoverStalledResponseNavigation(
      handledWatchdog.tabId,
      handledWatchdog.url,
      Number(handledWatchdog.scheduledAt) || 0
    );
  } finally {
    const { responseNavigationWatchdog: currentWatchdog = null } = await storageGet(['responseNavigationWatchdog']);
    if (
      currentWatchdog?.tabId === handledWatchdog.tabId &&
      currentWatchdog?.url === handledWatchdog.url &&
      Number(currentWatchdog?.scheduledAt) === Number(handledWatchdog.scheduledAt)
    ) {
      await storageSet({ responseNavigationWatchdog: null });
    }
  }
}

async function restoreResponseNavigationWatchdogAlarm() {
  if (!chrome.alarms?.create) return;
  const { responseNavigationWatchdog = null } = await storageGet(['responseNavigationWatchdog']);
  if (!responseNavigationWatchdog?.tabId || !responseNavigationWatchdog?.url) return;
  const scheduledAt = Number(responseNavigationWatchdog.scheduledAt) || Date.now();
  const deadline = scheduledAt + getResponseNavigationWatchdogMs();
  if (deadline <= Date.now()) {
    await handleResponseNavigationWatchdogAlarm();
    return;
  }
  chrome.alarms.create(RESPONSE_NAVIGATION_WATCHDOG_ALARM, { when: deadline });
}

async function scheduleResponseNavigationWatchdog(tabId, url) {
  if (!tabId || !isHhResponseFormUrl(url)) return;
  const scheduledAt = Date.now();
  try {
    await storageSet({ responseNavigationWatchdog: { tabId, url, scheduledAt } });
  } catch (error) {
    appendAgentLog('response_navigation_watchdog_error', {
      tabId,
      url,
      error: localizeError(error)
    }).catch(() => {});
    return;
  }
  if (chrome.alarms?.create) {
    chrome.alarms.create(RESPONSE_NAVIGATION_WATCHDOG_ALARM, {
      when: scheduledAt + getResponseNavigationWatchdogMs()
    });
    return;
  }
  setTimeout(() => {
    handleResponseNavigationWatchdogAlarm().catch((error) => {
      appendAgentLog('response_navigation_watchdog_error', {
        tabId,
        url,
        error: localizeError(error)
      }).catch(() => {});
    });
  }, getResponseNavigationWatchdogMs());
}

async function startAutoApplyFromActiveTab() {
  globalThis.HHJA_CONFIG_READINESS.assertReady(await storageGet(['groqApiKey', 'resumeUrl', 'coverPrompt', 'employerQuestionPrompt']));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isAutoApplyStartUrl(tab.url)) {
    throw new Error('Перед запуском откликов откройте страницу поиска вакансий или форму отклика на hh.ru.');
  }
  await appendAgentLog('command_start_auto_apply', { tabId: tab.id, url: tab.url });
  return chrome.tabs.sendMessage(tab.id, { type: 'START_AUTO_APPLY' });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await restoreResponseNavigationWatchdogAlarm();
});

chrome.alarms?.onAlarm?.addListener?.((alarm) => {
  if (alarm?.name !== RESPONSE_NAVIGATION_WATCHDOG_ALARM) return;
  handleResponseNavigationWatchdogAlarm().catch((error) => {
    appendAgentLog('response_navigation_watchdog_error', {
      alarm: alarm.name,
      error: localizeError(error)
    }).catch(() => {});
  });
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
  return scheduleResponseNavigationWatchdog(tabId, url).catch((error) => {
    appendAgentLog('response_navigation_watchdog_error', {
      tabId,
      url,
      error: localizeError(error)
    }).catch(() => {});
  });
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
      case 'RELOAD_EXTENSION': {
        await appendAgentLog('reload_extension', {
          reason: message.reason || 'manual',
          url: message.url || sender?.tab?.url || ''
        });
        sendResponse({ ok: true, reloading: true });
        chrome.runtime.reload();
        break;
      }
      case 'STOP_RUN': {
        await storageSet({
          autoApplyStopRequested: true,
          autoApplyStopRequestedAt: nowIso()
        });
        await setRunState({ state: 'stopped', currentAction: 'Остановлено', lastError: '' });
        sendResponse({ ok: true });
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
      case 'NAVIGATE_TAB': {
        const tabId = sender?.tab?.id;
        const url = String(message.url || '');
        if (!tabId || !isAllowedTabNavigationUrl(url)) {
          sendResponse({ ok: false, error: 'Navigation target is not allowed.' });
          break;
        }
        await chrome.tabs.update(tabId, { url });
        sendResponse({ ok: true });
        break;
      }
      case 'GENERATE_COVER_LETTER': {
        const result = await callGroq({
          task: message.task || 'cover_letter',
          vacancyText: message.vacancyText || '',
          extraText: message.extraText || '',
          questions: message.questions || [],
          coverLetterRequested: message.coverLetterRequested === true
        });
        sendResponse({ ok: true, ...result });
        break;
      }
      case 'RECORD_AI_FALLBACK': {
        await recordAiQuotaFallback(message.task || 'test_assist', message.reason || 'local_fallback');
        sendResponse({ ok: true });
        break;
      }
      case 'BUILD_RESUME_PROFILE': {
        const result = await buildResumeProfile();
        sendResponse({ ok: true, ...result });
        break;
      }
      case 'ENSURE_RESUME_PROFILE': {
        const result = await ensureResumeProfileAutoRefresh();
        sendResponse({ ok: true, refreshed: true, profileAvailable: Boolean(result?.resumeProfileText) });
        break;
      }
      case 'EDIT_RESUME_PROFILE': {
        const result = await editResumeProfile(message.comment || '');
        sendResponse({ ok: true, ...result });
        break;
      }
      case 'TEST_GROQ': {
        const result = await testGroq();
        sendResponse(result);
        break;
      }
      case 'REFRESH_RESUMES_NOW': {
        const { resumeUrl } = await storageGet(['resumeUrl']);
        const resumeMissing = globalThis.HHJA_CONFIG_READINESS
          .evaluate({ resumeUrl, groqApiKey: 'unused', coverPrompt: 'unused', employerQuestionPrompt: 'unused' })
          .missing.some((item) => item.code === 'resume_url');
        if (resumeMissing) {
          throw new Error('Укажите ссылку на резюме в настройках');
        }
        const result = await runResumeRefresh();
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
