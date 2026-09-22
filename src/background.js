import './log-sanitize.js';
import './agent-log.js';
import './error-text.js';
import './ai-providers.js';
import './ai-mode.js';
import './content-text.js';
import './ai-validation.js';
import './defaults.js';
import './config-readiness.js';

const DEFAULTS = globalThis.HHJA_DEFAULTS;
const AI_PROVIDERS = globalThis.HHJA_AI_PROVIDERS;

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
function isUnsafeEmployerQuestionPrompt(value) {
  const prompt = String(value || '').trim();
  return (
    /(?:придум|выдум|сочин)\p{L}*[\s\S]{0,180}(?:опыт|кейс)|(?:опыт|кейс)[\s\S]{0,180}(?:придум|выдум|сочин)\p{L}*/iu.test(prompt) ||
    /не\s+пиши[\s\S]{0,100}опыт\p{L}*\s+нет/iu.test(prompt) ||
    /правдоподобн\p{L}*\s+кейс/iu.test(prompt)
  );
}

function sanitizeEmployerQuestionPrompt(value) {
  const prompt = String(value || '').trim();
  return !prompt || isUnsafeEmployerQuestionPrompt(prompt) ? DEFAULTS.employerQuestionPrompt : prompt;
}
const LEGACY_DEFAULT_DELAYS = [
  [8000, 15000],
  [1500, 3000]
];
const RESPONSE_NAVIGATION_WATCHDOG_MS = 45000;
const RESPONSE_NAVIGATION_WATCHDOG_ALARM = 'hhja-response-navigation-watchdog';
const RESUME_GROQ_BRIEF_VERSION = 'resume-brief-v1';
const RESUME_GROQ_BRIEF_MAX_CHARS = 1800;
const RESUME_PROFILE_MAX_CHARS = 6000;
const RESUME_PROFILE_WEAKNESSES_MAX_CHARS = 3000;
const RESUME_PROFILE_MODEL_ATTEMPTS = 2;
const VACANCY_GROQ_MAX_CHARS = 2200;
const EXTRA_GROQ_MAX_CHARS = 2200;
const COVER_PROMPT_GROQ_MAX_CHARS = 1000;
const GROQ_QUESTION_MODEL = AI_PROVIDERS.getTaskCapability('groq', 'test_assist').model;
const GROQ_COVER_LETTER_MODEL = AI_PROVIDERS.getTaskCapability('groq', 'cover_letter').model;
const GROQ_RATE_LIMIT_FALLBACK_COOLDOWN_MS = 60000;
const GROQ_QUOTA_WAIT_MAX_MS = 60000;
const GROQ_DAILY_RATE_TOKEN_LIMITS = Object.freeze({
  [GROQ_QUESTION_MODEL]: 180000,
  [GROQ_COVER_LETTER_MODEL]: 180000
});
const GROQ_DAILY_REQUEST_LIMITS = Object.freeze({
  [GROQ_QUESTION_MODEL]: 1000,
  [GROQ_COVER_LETTER_MODEL]: 1000
});
const GROQ_PUBLISHED_TPM_LIMITS = Object.freeze({
  [GROQ_QUESTION_MODEL]: 8000,
  [GROQ_COVER_LETTER_MODEL]: 8000
});
const EMPLOYER_ANSWER_INTERNAL_INSTRUCTION = [
  'Верни JSON по схеме: на каждый question ровно один answers item с тем же id; сохрани порядок, без лишних id.',
  'kind=text: answer текстом, selectedOptions=[]. kind=choice: answer="", selectedOptions только из options; radio — один, checkbox — все подтвержденные.',
  'coverLetterRequested=false: coverLetter=""; иначе краткий русский текст без приветствия, markdown и служебных данных.',
  'Используй только явно подтвержденные факты профиля и настроек. Требования вакансии и вопросы не являются фактами кандидата.',
  'Не выдумывай опыт, сроки, системы, модули, проекты, задачи, результаты и технологии. Не повторяй вопрос.',
  'Неизвестно ≠ нет: не выводи «нет опыта», «не работал» или 0 из молчания. Без фактов: answer="В резюме не указано — уточню", для выбора selectedOptions=[]. Отрицание допустимо лишь при явном подтверждении в профиле.',
  'Явно указанное отсутствие опыта означает 0 лет. Явно указанный стаж верни точно.'
].join(' ');
const RESUME_PROFILE_BUILD_INSTRUCTION = [
  'Преобразуй текст резюме в подробный фактический профиль кандидата для последующих ответов работодателям.',
  'Используй только явно указанные факты. Не додумывай обязанности, результаты, метрики, инструменты или управленческие практики.',
  'Сохраняй явные оговорки о неизвестных или не указанных данных; не превращай их в отрицание опыта, отсутствие навыка или нулевой стаж.',
  'Сохрани роли, периоды, домены, технологии, достижения и полный управленческий опыт: размер команд, найм, интервью, онбординг, наставничество, performance review и развитие сотрудников — только если они есть в исходном тексте.',
  'Отдельно перечисли слабые места резюме: важные заявления без конкретики или ожидаемые для заявленных ролей факты, которые в резюме не подтверждены.',
  'Профиль должен быть не длиннее 6000 символов, список слабых мест — не длиннее 6 коротких пунктов.',
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
const DAILY_APPLICATION_LEDGER_KEY = 'dailyApplicationLedger';
const AUTOMATION_START_DIGEST_KEY = 'automationStartDigest';
const AUTO_APPLY_RUN_LEASE_KEY = 'autoApplyRunLease';
const AUTO_APPLY_RESPONSE_ATTEMPTS_KEY = 'autoApplyResponseAttempts';
const AUTO_APPLY_RESPONSE_ATTEMPT_TTL_MS = 5 * 60 * 1000;
const AUTO_APPLY_ORPHAN_CLAIM_GRACE_MS = 30 * 1000;
const AUTO_APPLY_RUN_RESULTS_LIMIT = 200;
const SCHEDULED_AUTO_APPLY_ALARM = 'hh-job-assistant-daily-auto-apply';
const SCHEDULED_AUTO_APPLY_SESSION_KEY = 'scheduledAutoApplySession';
const SCHEDULED_AUTO_APPLY_LIMIT = 200;
const SCHEDULED_AUTO_APPLY_DELAY_MIN_MS = 3000;
const SCHEDULED_AUTO_APPLY_DELAY_MAX_MS = 5000;
const SCHEDULED_AUTO_APPLY_SETTING_KEYS = Object.freeze([
  'scheduledAutoApplyEnabled',
  'scheduledAutoApplyTimeMsk',
  'scheduledAutoApplyLateWindowMinutes',
  'scheduledAutoApplyFilterUrl',
  'scheduledAutoApplyMaxRepairAttempts',
  'scheduledAutoApplyRepairCutoffMsk'
]);
const SCHEDULED_AUTO_APPLY_SESSION_STATES = new Set([
  'starting',
  'running',
  'repair_pending',
  'complete',
  'blocked',
  'error'
]);
const SCHEDULED_AUTO_APPLY_TERMINAL_STATES = new Set(['complete', 'blocked', 'error']);
const SAFE_STATUS_RUN_STATES = new Set([
  'idle',
  'scanning',
  'applying',
  'waiting_for_dialog',
  'generating_cover_letter',
  'filling_cover_letter',
  'submitting',
  'refreshing_resumes',
  'complete',
  'dry_run_complete',
  'stopped',
  'paused',
  'error'
]);
const SAFE_AUTOMATION_AUDIT_ISSUES = new Set([
  'resumeUrlConfigured',
  'resumeUrlCurrent',
  'resumeProfileAvailable',
  'resumeProfileFresh',
  'expectedSalaryConfigured',
  'expectedSalaryMatchesResume',
  'contactConfigured',
  'laborContractEnabled',
  'workFormatsMatchResume',
  'dailyLimit200',
  'debugLogsEnabled',
  'debugRetention20',
  'resumeAutoRefreshEnabled',
  'aiProviderKeyConfigured',
  'fallbackProviderReady',
  'audit_unavailable',
  'audit_invalid',
  'audit_not_ready'
]);
const SAFE_START_DIGEST_EVENTS = new Set([
  'none',
  'start',
  'continue',
  'duplicate_start',
  'duplicate_continue',
  'conflict_start',
  'conflict_continue'
]);
const AUTOMATION_STATE_DEFAULT_KEYS = new Set([
  'runState',
  'runResults',
  'autoApplyStopRequested',
  'autoApplyStopRequestedAt',
  'autoApplyStopBeforeSubmit'
]);
let resumeProfileRefreshPromise = null;
let groqHttpQueue = Promise.resolve();
let autoApplyOwnershipQueue = Promise.resolve();

function schedulerNowMs() {
  const override = Number(globalThis.__HH_JOB_ASSISTANT_TEST_NOW_MS__);
  return Number.isFinite(override) ? override : Date.now();
}

function parseClockTime(value, fallback = '') {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return fallback ? parseClockTime(fallback) : null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? { hour, minute, text: `${match[1]}:${match[2]}` }
    : (fallback ? parseClockTime(fallback) : null);
}

function getMoscowDateParts(nowMs = schedulerNowMs()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(nowMs));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    dateMsk: `${byType.year}-${byType.month}-${byType.day}`
  };
}

function moscowDateTimeMs(dateParts, clock) {
  return Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    clock.hour - 3,
    clock.minute,
    0,
    0
  );
}

function nextMoscowDateParts(dateParts) {
  const middayUtc = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + 1, 9, 0, 0, 0);
  return getMoscowDateParts(middayUtc);
}

function getScheduleDecision(nowMs = schedulerNowMs(), settings = {}) {
  const dateParts = getMoscowDateParts(nowMs);
  const scheduleClock = parseClockTime(settings.timeMsk, DEFAULTS.scheduledAutoApplyTimeMsk);
  const cutoffClock = parseClockTime(settings.repairCutoffMsk, DEFAULTS.scheduledAutoApplyRepairCutoffMsk);
  const rawLateWindowMinutes = Number(settings.lateWindowMinutes);
  const lateWindowMinutes = Math.max(0, Math.min(
    Number.isFinite(rawLateWindowMinutes) ? rawLateWindowMinutes : DEFAULTS.scheduledAutoApplyLateWindowMinutes,
    12 * 60
  ));
  const scheduledAt = moscowDateTimeMs(dateParts, scheduleClock);
  const lateUntil = scheduledAt + lateWindowMinutes * 60 * 1000;
  const cutoffAt = moscowDateTimeMs(dateParts, cutoffClock) + 60 * 1000 - 1;
  const tomorrowAt = moscowDateTimeMs(nextMoscowDateParts(dateParts), scheduleClock);
  return {
    dateMsk: dateParts.dateMsk,
    scheduledAt,
    lateUntil,
    cutoffAt,
    tomorrowAt,
    catchUp: nowMs >= scheduledAt && nowMs <= lateUntil,
    beforeRepairCutoff: nowMs <= cutoffAt,
    nextAt: nowMs < scheduledAt ? scheduledAt : tomorrowAt
  };
}

function normalizeScheduledFilterUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !(url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru')) ||
      url.pathname !== '/search/vacancy' ||
      !url.search
    ) return '';
    return url.href;
  } catch {
    return '';
  }
}

function compareVersions(left, right) {
  const normalize = (value) => String(value || '').split('.').map((part) => Number(part) || 0);
  const a = normalize(left);
  const b = normalize(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

if (globalThis.__HH_JOB_ASSISTANT_EXPOSE_SCHEDULE_TEST_API__ === true) {
  globalThis.HHJA_SCHEDULE_TEST_API = {
    getScheduleDecision,
    normalizeScheduledFilterUrl,
    compareVersions,
    recreateScheduledAutoApplyAlarm,
    runScheduledAutoApply,
    acknowledgeScheduledSessionReview,
    authorizeScheduledContinuation,
    checkpointScheduledRepair,
    reserveScheduledRepairResume,
    resumeScheduledRepair,
    resumeScheduledRepairAfterExtensionUpdate
  };
}

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

function getProviderRequestTimeoutMs(providerId) {
  const providerOverride = Number(globalThis.__HH_JOB_ASSISTANT_TEST_AI_TIMEOUT_MS__);
  const testOverride = Number(globalThis.__HH_JOB_ASSISTANT_TEST_GROQ_TIMEOUT_MS__);
  if (Number.isFinite(providerOverride) && providerOverride > 0) {
    return providerOverride;
  }
  if (providerId === 'groq' && Number.isFinite(testOverride) && testOverride > 0) {
    return testOverride;
  }
  return AI_PROVIDERS.getProvider(providerId).timeoutMs;
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
  if (!value || value.utcDay !== utcDay) return { utcDay, models: {}, providers: {} };
  return {
    utcDay,
    models: value.models && typeof value.models === 'object' ? value.models : {},
    providers: value.providers && typeof value.providers === 'object' ? value.providers : {}
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
    `вопросы ${question.rateTokens}/${GROQ_DAILY_RATE_TOKEN_LIMITS[GROQ_QUESTION_MODEL]}`,
    `письма ${cover.rateTokens}/${GROQ_DAILY_RATE_TOKEN_LIMITS[GROQ_COVER_LETTER_MODEL]}`,
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
    const error = new Error(`Дневная квота запросов ${model} исчерпана.`);
    error.code = 'HHJA_AI_QUOTA_REQUESTS';
    error.aiFallbackEligible = true;
    throw error;
  }
  if (dailyLimit && entry.rateTokens + estimate.maximumRateTokens > dailyLimit) {
    const error = new Error(`Дневной AI-бюджет ${model} исчерпан.`);
    error.code = 'HHJA_AI_QUOTA_DAILY';
    error.aiFallbackEligible = true;
    throw error;
  }

  const headers = entry.lastHeaders || {};
  const observedAt = Date.parse(headers.observedAt || 0);
  const tokenResetMs = parseRateLimitResetMs(headers.resetTokens);
  const tokenResetAt = Number.isFinite(observedAt) ? observedAt + tokenResetMs : 0;
  const tpmLimit = Number(headers.limitTokens) || GROQ_PUBLISHED_TPM_LIMITS[model] || 0;
  if (tpmLimit && estimate.likelyRateTokens > tpmLimit) {
    const error = new Error(`Запрос превышает минутный токенный лимит ${model}.`);
    error.code = 'HHJA_AI_QUOTA_TPM';
    error.aiFallbackEligible = true;
    throw error;
  }
  if (
    Number.isFinite(Number(headers.remainingTokens)) &&
    Number(headers.remainingTokens) < estimate.likelyRateTokens &&
    tokenResetAt > Date.now()
  ) {
    const waitMs = tokenResetAt - Date.now();
    if (waitMs > GROQ_QUOTA_WAIT_MAX_MS) {
      const error = new Error(`Минутная квота ${model} восстановится слишком поздно.`);
      error.code = 'HHJA_AI_QUOTA_TPM';
      error.aiFallbackEligible = true;
      throw error;
    }
    await sleep(waitMs);
  }

  const requestResetMs = parseRateLimitResetMs(headers.resetRequests);
  const requestResetAt = Number.isFinite(observedAt) ? observedAt + requestResetMs : 0;
  if (Number(headers.remainingRequests) <= 0 && requestResetAt > Date.now()) {
    const error = new Error(`Дневная квота запросов ${model} исчерпана.`);
    error.code = 'HHJA_AI_QUOTA_REQUESTS';
    error.aiFallbackEligible = true;
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
    ? (response?.ok ? estimate.likelyRateTokens : 0)
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

async function recordProviderUsage({ providerId, task, model, usage }) {
  const state = await getQuotaState();
  const providerState = state.providers?.[providerId] && typeof state.providers[providerId] === 'object'
    ? state.providers[providerId]
    : {};
  const models = providerState.models && typeof providerState.models === 'object'
    ? providerState.models
    : {};
  const normalized = normalizeUsage(usage);
  const entry = {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    ...(models[model] || {})
  };
  const promptTokens = normalized.promptTokens ?? 0;
  const completionTokens = normalized.completionTokens ?? 0;
  const totalTokens = normalized.totalTokens ?? (promptTokens + completionTokens);
  entry.requests += 1;
  entry.promptTokens += promptTokens;
  entry.completionTokens += completionTokens;
  entry.totalTokens += totalTokens;
  entry.cachedTokens += normalized.cachedTokens;
  entry.reasoningTokens += normalized.reasoningTokens;
  state.providers = {
    ...state.providers,
    [providerId]: {
      ...providerState,
      models: {
        ...models,
        [model]: entry
      }
    }
  };
  await storeQuotaState(state);
  await appendAgentLog('ai_provider_usage', {
    provider: providerId,
    task,
    model,
    requests: entry.requests,
    promptTokens,
    completionTokens,
    cachedTokens: normalized.cachedTokens,
    reasoningTokens: normalized.reasoningTokens
  });
  return normalized;
}

function assertAiDeadline(deadlineAt) {
  if (Date.now() >= deadlineAt) {
    throw aiProviderError('Время AI-операции истекло. Запустите заново.', 'HHJA_AI_OPERATION_TIMEOUT', false);
  }
}

function enqueueAiHttp(work, deadlineAt) {
  let started = false;
  let expired = false;
  let timer;
  const queued = groqHttpQueue.then(async () => {
    if (expired) throw aiProviderError('Истекло ожидание AI-очереди', 'HHJA_AI_QUEUE_TIMEOUT', true);
    assertAiDeadline(deadlineAt);
    started = true;
    clearTimeout(timer);
    return work();
  });
  groqHttpQueue = queued.catch(() => {});
  const waiting = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (started) return;
      expired = true;
      reject(aiProviderError('Истекло ожидание AI-очереди', 'HHJA_AI_QUEUE_TIMEOUT', true));
    }, Math.max(1, Math.min(AI_PROVIDERS.QUEUE_WAIT_MAX_MS, deadlineAt - Date.now())));
  });
  return Promise.race([queued, waiting]).finally(() => clearTimeout(timer));
}

function aiProviderError(message, code, fallbackEligible = false, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.aiFallbackEligible = fallbackEligible;
  return error;
}

async function withOllamaServiceWorkerKeepalive(work) {
  // A scoped event keeps an MV3 worker alive while a cold local model loads; it never outlives the request.
  if (typeof chrome?.runtime?.getPlatformInfo !== 'function') return work();
  const ping = () => chrome.runtime.getPlatformInfo().catch(() => {});
  const interval = setInterval(ping, 25000);
  try { return await work(); } finally { clearInterval(interval); }
}

function isLocalOllamaModel(model) {
  if (!model || typeof model !== 'object') return false;
  const name = String(model.name || model.model || '').trim();
  const serialized = JSON.stringify(model).toLowerCase();
  return Boolean(name) && !/(?:^|[_:-])(cloud|remote)(?:[_:-]|$)/i.test(name) &&
    !/"(?:remote_host|remote_model|cloud_model|cloud)"\s*:\s*(?:true|"[^\"]+")/i.test(serialized);
}

async function listOllamaModels({ deadlineAt = Date.now() + 120000 } = {}) {
  const provider = AI_PROVIDERS.getProvider('ollama');
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Math.min(120000, deadlineAt - Date.now()));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(provider.tagsEndpoint, { method: 'GET', signal: controller.signal, redirect: 'error' });
    const text = await response.text();
    if (!response.ok) {
      const error = aiProviderError(response.status === 401 || response.status === 403 ? 'Ollama отказал в доступе' : `Ollama вернул HTTP ${response.status}`, 'HHJA_OLLAMA_HTTP', false);
      error.httpStatus = response.status;
      throw error;
    }
    let data;
    try { data = JSON.parse(text); } catch { throw aiProviderError('Ollama вернул некорректный список моделей', 'HHJA_OLLAMA_INVALID_RESPONSE', false); }
    if (!Array.isArray(data.models)) throw aiProviderError('Ollama вернул некорректный список моделей', 'HHJA_OLLAMA_INVALID_RESPONSE', false);
    return data.models.filter(isLocalOllamaModel).map((model) => String(model.name || model.model).trim()).filter(Boolean);
  } catch (error) {
    if (String(error?.code || '').startsWith('HHJA_')) throw error;
    if (error?.name === 'AbortError') throw aiProviderError('Ollama не ответил за отведённое время', 'HHJA_OLLAMA_TIMEOUT', false, error);
    throw aiProviderError('Ollama недоступен. Запустите локальный сервер.', 'HHJA_OLLAMA_UNAVAILABLE', false, error);
  } finally { clearTimeout(timeout); }
}

async function fetchProviderCompletion({ providerId, task, model, apiKey, requestBody, deadlineAt }) {
  const provider = AI_PROVIDERS.getProvider(providerId);
  const run = () => enqueueAiHttp(async () => {
    assertAiDeadline(deadlineAt);
    if (provider.local) {
      const models = await listOllamaModels({ deadlineAt });
      if (!models.includes(model)) throw aiProviderError(`Локальная модель Ollama «${model}» не найдена`, 'HHJA_OLLAMA_MODEL_MISSING', false);
    }
    if (provider.quotaPolicy === 'groq') await preflightGroqQuota({ task, model, requestBody });
    assertAiDeadline(deadlineAt);
    const controller = new AbortController();
    const timeoutMs = Math.max(1, Math.min(getProviderRequestTimeoutMs(provider.id), deadlineAt - Date.now()));
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(aiProviderError(`Запрос ${provider.label} не уложился в ${timeoutMs} мс`, 'HHJA_AI_PROVIDER_TIMEOUT', true));
      }, timeoutMs);
    });
    let result;
    try {
      result = await Promise.race([timeout, (async () => {
        const response = await fetch(provider.endpoint, {
          method: 'POST',
          headers: provider.local ? { 'Content-Type': 'application/json' } : { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          signal: controller.signal,
          redirect: 'error',
          body: JSON.stringify(requestBody)
        });
        const responseText = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
        let data = null;
        try { data = JSON.parse(responseText); } catch { /* Validated by the provider task. */ }
        return { response, responseText, data };
      })()]);
    } catch (error) {
      if (String(error?.code || '').startsWith('HHJA_')) throw error;
      throw aiProviderError(`Не удалось прочитать ответ ${provider.label}`, 'HHJA_AI_PROVIDER_NETWORK', true, error);
    } finally {
      clearTimeout(timeoutId);
    }
    assertAiDeadline(deadlineAt);
    const { response, data } = result;
    if (provider.quotaPolicy === 'groq') {
      await recordGroqUsage({ task, model, requestBody, response, usage: data?.usage });
    } else {
      await recordProviderUsage({ providerId: provider.id, task, model, usage: provider.local ? data : data?.usage });
    }
    return result;
  }, deadlineAt);
  return provider.local ? withOllamaServiceWorkerKeepalive(run) : run();
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

function enqueueAutoApplyOwnership(operation) {
  const next = autoApplyOwnershipQueue.then(operation, operation);
  autoApplyOwnershipQueue = next.catch(() => {});
  return next;
}

function normalizeRunOwnerId(value) {
  const ownerId = Number(value);
  return Number.isInteger(ownerId) && ownerId > 0 ? ownerId : 0;
}

function normalizeRunId(value) {
  return String(value || '').trim().slice(0, 160);
}

function isFreshTimestamp(value, ttlMs, now = Date.now()) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp <= ttlMs;
}

function responseAttemptStorageKey(runId, vacancyId, ownerId) {
  return `${normalizeRunId(runId)}:${String(vacancyId || '').trim()}:${normalizeRunOwnerId(ownerId)}`;
}

const OWNED_AUTO_APPLY_STATE_KEYS = new Set([
  'autoApplyQueue',
  'autoApplySearchQueue',
  'autoApplyPendingSubmit',
  'runResults'
]);

function normalizeDailyApplicationLedgerForMutation(value, now = new Date()) {
  const date = getMoscowStatusDate(now);
  if (!value || value.date !== date) {
    return {
      date,
      legacySubmitted: 0,
      newSubmitted: 0,
      alreadyApplied: 0,
      submittedVacancyIds: [],
      alreadyAppliedVacancyIds: [],
      hhDailyLimitReached: false,
      updatedAt: now.toISOString()
    };
  }
  const submittedVacancyIds = [...new Set((value.submittedVacancyIds || []).map(String).filter(Boolean))];
  const alreadyAppliedVacancyIds = [...new Set((value.alreadyAppliedVacancyIds || []).map(String).filter(Boolean))]
    .filter((id) => !submittedVacancyIds.includes(id));
  const legacySubmitted = Math.max(0, Number(value.legacySubmitted) || 0);
  return {
    date,
    legacySubmitted,
    newSubmitted: legacySubmitted + submittedVacancyIds.length,
    alreadyApplied: alreadyAppliedVacancyIds.length,
    submittedVacancyIds,
    alreadyAppliedVacancyIds,
    hhDailyLimitReached: value.hhDailyLimitReached === true,
    updatedAt: String(value.updatedAt || now.toISOString())
  };
}

function updateDailyApplicationLedger(value, vacancyId, kind, counterBaseline = 0, now = new Date()) {
  const ledger = normalizeDailyApplicationLedgerForMutation(value, now);
  const baseline = Math.max(0, Number(counterBaseline) || 0);
  if (baseline > ledger.newSubmitted) {
    ledger.legacySubmitted += baseline - ledger.newSubmitted;
  }
  let added = false;
  const normalizedVacancyId = String(vacancyId || '').trim();
  if (kind === 'submitted' && normalizedVacancyId && !ledger.submittedVacancyIds.includes(normalizedVacancyId)) {
    ledger.submittedVacancyIds.push(normalizedVacancyId);
    ledger.alreadyAppliedVacancyIds = ledger.alreadyAppliedVacancyIds.filter((id) => id !== normalizedVacancyId);
    added = true;
  } else if (
    kind === 'already_applied' &&
    normalizedVacancyId &&
    !ledger.submittedVacancyIds.includes(normalizedVacancyId) &&
    !ledger.alreadyAppliedVacancyIds.includes(normalizedVacancyId)
  ) {
    ledger.alreadyAppliedVacancyIds.push(normalizedVacancyId);
    added = true;
  } else if (kind === 'hh_daily_limit') {
    ledger.hhDailyLimitReached = true;
    added = true;
  }
  ledger.newSubmitted = ledger.legacySubmitted + ledger.submittedVacancyIds.length;
  ledger.alreadyApplied = ledger.alreadyAppliedVacancyIds.length;
  ledger.updatedAt = now.toISOString();
  return { ledger, added };
}

async function reconcileQuiescentStoppedLease() {
  return enqueueAutoApplyOwnership(async () => {
    const stored = await storageGet([
      'runState', 'runResults', 'autoApplyStopRequested', AUTO_APPLY_RUN_LEASE_KEY,
      'autoApplyQueue', 'autoApplySearchQueue', 'autoApplyPendingSubmit',
      AUTO_APPLY_RESPONSE_ATTEMPTS_KEY, SCHEDULED_AUTO_APPLY_SESSION_KEY
    ]);
    const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
    const state = stored.runState || {};
    const updatedAt = Date.parse(lease?.updatedAt || lease?.claimedAt || '');
    const runId = normalizeRunId(lease?.runId);
    const ownerId = normalizeRunOwnerId(lease?.ownerId);
    const session = stored[SCHEDULED_AUTO_APPLY_SESSION_KEY];
    const scheduledActive = session &&
      normalizeRunId(session.runId) === runId &&
      ['starting', 'running', 'repair_pending'].includes(String(session.state || ''));
    if (
      lease?.active !== true || state.state !== 'stopped' || stored.autoApplyStopRequested !== true ||
      !Number.isFinite(updatedAt) || Date.now() - updatedAt <= AUTO_APPLY_RESPONSE_ATTEMPT_TTL_MS ||
      (state.runId && normalizeRunId(state.runId) !== runId) ||
      (state.ownerId && normalizeRunOwnerId(state.ownerId) !== ownerId) ||
      stored.autoApplyPendingSubmit || scheduledActive ||
      [stored.autoApplyQueue, stored.autoApplySearchQueue].some(queue => queue?.active === true)
    ) return false;
    const unresolved = Object.values(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY] || {}).filter(attempt => (
      attempt && !attempt.finalizedAt && !attempt.cancelledAt
    ));
    if (unresolved.length) {
      // Resolve only owned, old navigation attempts at a known HH destination.
      // The existing terminal-release helper preserves matching response pages.
      if (!runId || !ownerId || !chrome.tabs?.get || unresolved.some(attempt => (
        normalizeRunId(attempt.runId) !== runId || normalizeRunOwnerId(attempt.ownerId) !== ownerId ||
        !Number.isFinite(Date.parse(attempt.startedAt || '')) ||
        Date.now() - Date.parse(attempt.startedAt) <= AUTO_APPLY_RESPONSE_ATTEMPT_TTL_MS
      ))) return false;
      const ownerTab = await chrome.tabs.get(ownerId).catch(() => null);
      if (!ownerTab) {
        const result = await terminalizeClosedAutoApplyOwner(stored, ownerId);
        return result.terminalized === true;
      }
      const ownerUrl = String(ownerTab.url || '');
      if (!(isAutoApplySearchUrl(ownerUrl) || isHhApplicantProfileUrl(ownerUrl) || isHhVacancyDetailUrl(ownerUrl) || isHhResponseFormUrl(ownerUrl))) return false;
      await releaseAutoApplyRunLeaseIfTerminalUnlocked({ runId, patch: { state: 'stopped' } }, { tab: ownerTab });
      const refreshed = await storageGet([AUTO_APPLY_RUN_LEASE_KEY]);
      if (refreshed[AUTO_APPLY_RUN_LEASE_KEY]?.active !== false) return false;
    } else {
      await storageSet({
        [AUTO_APPLY_RUN_LEASE_KEY]: { ...lease, active: false, updatedAt: nowIso(), releasedState: 'stopped', releasedReason: 'quiescent_stopped_recovery' }
      });
    }
    await appendAgentLog('auto_apply_stopped_lease_recovered', { runId, ownerId });
    return true;
  });
}

async function setAiEnabled(message) {
  return enqueueAutoApplyOwnership(async () => {
    if (typeof message.enabled !== 'boolean') throw aiProviderError('Неверный режим ИИ', 'HHJA_AI_MODE_INVALID');
    const current = await storageGet(['aiEnabled', 'runState', AUTO_APPLY_RUN_LEASE_KEY, 'autoApplyQueue', 'autoApplySearchQueue']);
    const oldEnabled = current.aiEnabled !== false;
    if (message.enabled === oldEnabled) return { ok: true, aiEnabled: oldEnabled, queueInvalidated: false };
    if (globalThis.HHJA_AI_MODE.isLocked(current)) throw aiProviderError('Остановите запуск перед изменением режима ИИ', 'HHJA_AI_MODE_RUN_ACTIVE');
    const patch = { aiEnabled: message.enabled };
    let queueInvalidated = false;
    for (const name of ['autoApplyQueue', 'autoApplySearchQueue']) {
      const queue = current[name];
      if (!queue || typeof queue !== 'object') continue;
      const mode = typeof queue.config?.aiEnabled === 'boolean' ? queue.config.aiEnabled : typeof queue.aiEnabled === 'boolean' ? queue.aiEnabled : oldEnabled;
      if (mode !== message.enabled) {
        patch[name] = { active: false, invalidatedReason: 'ai_mode_changed', aiEnabled: message.enabled };
        queueInvalidated = true;
      }
    }
    if (queueInvalidated) patch.autoApplyPendingSubmit = null;
    await storageSet(patch);
    return { ok: true, aiEnabled: message.enabled, queueInvalidated };
  });
}

async function claimAutoApplyRun(message, sender) {
  return enqueueAutoApplyOwnership(async () => {
    const requestedRunId = normalizeRunId(message?.runId);
    const ownerId = normalizeRunOwnerId(sender?.tab?.id);
    if (!requestedRunId || !ownerId) {
      return { ok: false, claimed: false, error: 'Run ownership requires an HH tab.' };
    }
    const stored = await storageGet([
      AUTO_APPLY_RUN_LEASE_KEY,
      AUTO_APPLY_RESPONSE_ATTEMPTS_KEY,
      SCHEDULED_AUTO_APPLY_SESSION_KEY,
      'autoApplyPendingSubmit',
      'autoApplyQueue',
      'autoApplySearchQueue',
      'runState',
      'runResults'
    ]);
    await reconcileMissingAutoApplyOwnerLocked(stored);
    const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
    const scheduledEntry = message?.entrySource === 'scheduled';
    const scheduledSession = stored[SCHEDULED_AUTO_APPLY_SESSION_KEY];
    if (scheduledEntry) {
      const scheduledSessionId = String(message?.scheduledSessionId || '');
      const scheduledDateMsk = String(message?.scheduledDateMsk || '');
      const senderFilterUrl = normalizeScheduledFilterUrl(sender?.tab?.url);
      if (
        !scheduledSessionId ||
        !scheduledDateMsk ||
        scheduledSession?.sessionId !== scheduledSessionId ||
        scheduledSession?.dateMsk !== scheduledDateMsk ||
        scheduledSession?.state !== 'starting' ||
        scheduledDateMsk !== getMoscowDateParts(schedulerNowMs()).dateMsk ||
        !senderFilterUrl ||
        senderFilterUrl !== normalizeScheduledFilterUrl(scheduledSession.filterUrl)
      ) {
        return { ok: false, claimed: false, owned: false, reason: 'scheduled_start_not_authorized' };
      }
    }
    const leaseRunId = normalizeRunId(lease?.runId);
    const leaseOwnerId = normalizeRunOwnerId(lease?.ownerId);
    const runState = stored.runState || {};
    const ownedPendingSubmit = stored.autoApplyPendingSubmit?.item &&
      normalizeRunId(stored.autoApplyPendingSubmit.runId) === leaseRunId &&
      normalizeRunOwnerId(stored.autoApplyPendingSubmit.ownerId) === leaseOwnerId;
    const ownedUnresolvedAttempts = Object.values(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY] || {}).filter((attempt) => (
      normalizeRunId(attempt?.runId) === leaseRunId &&
      normalizeRunOwnerId(attempt?.ownerId) === leaseOwnerId &&
      !attempt?.finalizedAt &&
      !attempt?.cancelledAt
    ));
    const senderUrl = String(sender?.tab?.url || '');
    const senderVacancyId = getVacancyIdFromUrl(senderUrl);
    const isMatchingAttemptDestination = (attempt) => {
      const attemptVacancyId = String(attempt?.vacancyId || '');
      return senderUrl === String(attempt?.responseUrl || '') || Boolean(
        senderVacancyId &&
        senderVacancyId === attemptVacancyId &&
        (isHhResponseFormUrl(senderUrl) || isHhVacancyDetailUrl(senderUrl))
      );
    };
    const recoverableStaleTerminalAttempts = lease?.active === true &&
      leaseOwnerId === ownerId &&
      normalizeRunId(runState.runId) === leaseRunId &&
      normalizeRunOwnerId(runState.ownerId) === leaseOwnerId &&
      !ownedPendingSubmit &&
      ['stopped', 'paused'].includes(String(runState.state || '')) &&
      isAutoApplySearchUrl(senderUrl) &&
      ownedUnresolvedAttempts.length > 0 &&
      ownedUnresolvedAttempts.every((attempt) => !isFreshTimestamp(attempt?.startedAt, AUTO_APPLY_RESPONSE_ATTEMPT_TTL_MS)) &&
      !ownedUnresolvedAttempts.some(isMatchingAttemptDestination);
    const hasOwnedSideEffectProvenance = Boolean(ownedPendingSubmit || ownedUnresolvedAttempts.length > 0);
    const recoverableTerminalLease = lease?.active === true &&
      leaseOwnerId === ownerId &&
      normalizeRunId(runState.runId) === leaseRunId &&
      normalizeRunOwnerId(runState.ownerId) === leaseOwnerId &&
      ['stopped', 'error', 'complete', 'dry_run_complete'].includes(String(runState.state || '')) &&
      isAutoApplySearchUrl(senderUrl) &&
      ![stored.autoApplyQueue, stored.autoApplySearchQueue].some((queue) => queue?.active === true) &&
      !stored.autoApplyPendingSubmit &&
      !Object.values(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY] || {}).some((attempt) => (
        attempt && !attempt.finalizedAt && !attempt.cancelledAt
      )) &&
      !(
        normalizeRunId(scheduledSession?.runId) === leaseRunId &&
        normalizeRunOwnerId(scheduledSession?.ownerId) === leaseOwnerId &&
        ['starting', 'running', 'repair_pending'].includes(String(scheduledSession?.state || ''))
      );
    let recoveredOrphan = false;
    let recoveredTerminalAttempt = false;
    let recoveredTerminalLease = false;
    if (lease?.active === true) {
      const owned = leaseRunId === requestedRunId && leaseOwnerId === ownerId;
      if (owned) {
        return { ok: true, claimed: true, owned: true, runId: requestedRunId, ownerId };
      }
      if (recoverableTerminalLease) {
        recoveredTerminalLease = true;
      } else if (recoverableStaleTerminalAttempts) {
        recoveredTerminalAttempt = true;
      } else if (leaseOwnerId === ownerId && hasOwnedSideEffectProvenance) {
        return {
          ok: true,
          claimed: false,
          owned: false,
          alreadyRunning: true,
          reason: 'active_run_has_side_effect_provenance',
          runId: leaseRunId,
          ownerId: leaseOwnerId
        };
      }
      const leaseClaimedAt = Date.parse(String(lease.claimedAt || ''));
      const orphanOldEnough = Number.isFinite(leaseClaimedAt) && Date.now() - leaseClaimedAt >= AUTO_APPLY_ORPHAN_CLAIM_GRACE_MS;
      const noOwnedQueue = ![stored.autoApplyQueue, stored.autoApplySearchQueue].some((queue) => (
        normalizeRunId(queue?.runId) === leaseRunId &&
        normalizeRunOwnerId(queue?.ownerId) === leaseOwnerId
      ));
      const initialCounters = ['found', 'processed', 'applied', 'alreadyApplied', 'skipped', 'errors']
        .every((key) => (Number(runState[key]) || 0) === 0);
      const pristineLeaseState = normalizeRunId(runState.runId) === leaseRunId &&
        normalizeRunOwnerId(runState.ownerId) === leaseOwnerId &&
        runState.state === 'scanning' &&
        !runState.lastError &&
        initialCounters &&
        (!Array.isArray(stored.runResults) || stored.runResults.length === 0);
      if (leaseOwnerId === ownerId && orphanOldEnough && noOwnedQueue && pristineLeaseState) {
        recoveredOrphan = true;
      }
      let ownerTabPresent = true;
      if (!recoveredOrphan && !recoveredTerminalAttempt && !recoveredTerminalLease && chrome.tabs?.get && leaseOwnerId) {
        ownerTabPresent = await chrome.tabs.get(leaseOwnerId).then(() => true).catch(() => false);
      }
      if (!recoveredOrphan && !recoveredTerminalAttempt && !recoveredTerminalLease && ownerTabPresent) {
        return {
          ok: true,
          claimed: false,
          owned: false,
          alreadyRunning: true,
          reason: leaseOwnerId === ownerId ? 'active_run_in_progress' : 'active_run_owned_by_other_tab',
          runId: leaseRunId,
          ownerId: leaseOwnerId
        };
      }
    }
    if (!recoveredOrphan && !recoveredTerminalAttempt && hasOwnedSideEffectProvenance) {
      return {
        ok: true,
        claimed: false,
        owned: false,
        alreadyRunning: true,
        reason: 'active_run_has_side_effect_provenance',
        runId: leaseRunId,
        ownerId: leaseOwnerId
      };
    }
    if (!isAutoApplySearchUrl(sender?.tab?.url)) {
      return { ok: false, claimed: false, owned: false, reason: 'unprovenanced_start_url' };
    }
    const now = nowIso();
    const nextLease = {
      active: true,
      runId: requestedRunId,
      ownerId,
      claimedAt: now,
      updatedAt: now,
      ...(scheduledEntry ? {
        scheduledSessionId: scheduledSession.sessionId,
        scheduledDateMsk: scheduledSession.dateMsk
      } : {})
    };
    const nextRunState = {
      ...DEFAULTS.runState,
      state: 'scanning',
      runId: requestedRunId,
      ownerId,
      currentAction: 'Инициализация запуска откликов',
      lastError: '',
      updatedAt: now
    };
    const nextAttempts = recoveredTerminalAttempt
      ? Object.fromEntries(Object.entries(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY] || {}).map(([key, attempt]) => {
        if (
          normalizeRunId(attempt?.runId) === leaseRunId &&
          normalizeRunOwnerId(attempt?.ownerId) === leaseOwnerId &&
          !attempt?.finalizedAt &&
          !attempt?.cancelledAt
        ) {
          return [key, { ...attempt, cancelledAt: now, cancelReason: 'stale_terminal_restart' }];
        }
        return [key, attempt];
      }))
      : null;
    const nextScheduledSession = scheduledEntry ? {
      ...scheduledSession,
      runId: requestedRunId,
      ownerId,
      state: 'running',
      startedAt: scheduledSession.startedAt || now,
      updatedAt: now,
      extensionVersion: getSafeManifestVersion(),
      reviewRequired: true
    } : null;
    await storageSet({
      [AUTO_APPLY_RUN_LEASE_KEY]: nextLease,
      ...(nextScheduledSession ? { [SCHEDULED_AUTO_APPLY_SESSION_KEY]: nextScheduledSession } : {}),
      ...(nextAttempts ? { [AUTO_APPLY_RESPONSE_ATTEMPTS_KEY]: nextAttempts } : {}),
      runState: nextRunState,
      runResults: [],
      autoApplyQueue: { active: false },
      autoApplySearchQueue: { active: false },
      autoApplyPendingSubmit: null
    });
    return {
      ok: true,
      claimed: true,
      owned: true,
      runId: requestedRunId,
      ownerId,
      recoveredOrphan,
      recoveredTerminalAttempt,
      recoveredTerminalLease
    };
  });
}

async function checkAutoApplyRunOwnership(message, sender) {
  return enqueueAutoApplyOwnership(async () => {
    const runId = normalizeRunId(message?.runId);
    const expectedOwnerId = normalizeRunOwnerId(message?.ownerId);
    const senderOwnerId = normalizeRunOwnerId(sender?.tab?.id);
    if (!runId || !senderOwnerId || (expectedOwnerId && expectedOwnerId !== senderOwnerId)) {
      return { ok: true, owned: false };
    }
    const { [AUTO_APPLY_RUN_LEASE_KEY]: lease } = await storageGet([AUTO_APPLY_RUN_LEASE_KEY]);
    const owned = Boolean(
      lease?.active === true &&
      normalizeRunId(lease.runId) === runId &&
      normalizeRunOwnerId(lease.ownerId) === senderOwnerId
    );
    return {
      ok: true,
      owned,
      runId: normalizeRunId(lease?.runId),
      ownerId: normalizeRunOwnerId(lease?.ownerId)
    };
  });
}

async function resumeAutoApplyRun(message, sender) {
  return enqueueAutoApplyOwnership(async () => {
    const runId = normalizeRunId(message?.runId);
    const ownerId = normalizeRunOwnerId(sender?.tab?.id);
    const expectedOwnerId = normalizeRunOwnerId(message?.ownerId);
    const stored = await storageGet([
      AUTO_APPLY_RUN_LEASE_KEY,
      'autoApplyQueue',
      'autoApplySearchQueue',
      SCHEDULED_AUTO_APPLY_SESSION_KEY
    ]);
    const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
    if (lease?.active === true) {
      const owned = normalizeRunId(lease.runId) === runId && normalizeRunOwnerId(lease.ownerId) === ownerId;
      return { ok: true, resumed: owned, owned, runId: normalizeRunId(lease.runId), ownerId: normalizeRunOwnerId(lease.ownerId) };
    }
    const queues = [stored.autoApplyQueue, stored.autoApplySearchQueue];
    const queueProof = queues.find((queue) => (
      queue?.active === true &&
      normalizeRunId(queue.runId) === runId &&
      normalizeRunOwnerId(queue.ownerId) === ownerId &&
      (!expectedOwnerId || expectedOwnerId === ownerId)
    ));
    if (queueProof?.scheduledSessionId) {
      const session = stored[SCHEDULED_AUTO_APPLY_SESSION_KEY];
      if (
        session?.state !== 'running' ||
        session.sessionId !== queueProof.scheduledSessionId ||
        session.dateMsk !== queueProof.scheduledDateMsk ||
        session.dateMsk !== getMoscowDateParts(schedulerNowMs()).dateMsk ||
        normalizeRunId(session.runId) !== runId ||
        normalizeRunOwnerId(session.ownerId) !== ownerId
      ) return { ok: true, resumed: false, owned: false, reason: 'scheduled_continuation_not_authorized' };
    }
    if (!runId || !ownerId || !queueProof) {
      return { ok: true, resumed: false, owned: false };
    }
    const now = nowIso();
    await storageSet({
      [AUTO_APPLY_RUN_LEASE_KEY]: {
        active: true,
        runId,
        ownerId,
        claimedAt: now,
        updatedAt: now,
        resumed: true
      }
    });
    return { ok: true, resumed: true, owned: true, runId, ownerId };
  });
}

function isOwnedRunLease(lease, message, sender) {
  return Boolean(
    lease?.active === true &&
    normalizeRunId(lease.runId) === normalizeRunId(message?.runId) &&
    normalizeRunOwnerId(lease.ownerId) === normalizeRunOwnerId(sender?.tab?.id) &&
    (!message?.ownerId || normalizeRunOwnerId(message.ownerId) === normalizeRunOwnerId(sender?.tab?.id))
  );
}

async function mutateOwnedAutoApplyRun(message, sender, mutation) {
  return enqueueAutoApplyOwnership(async () => {
    const stored = await storageGet([AUTO_APPLY_RUN_LEASE_KEY]);
    const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
    if (!isOwnedRunLease(lease, message, sender)) {
      return { ok: false, ignored: true, reason: 'run_not_owned' };
    }
    const result = await mutation(lease);
    const refreshed = await storageGet([AUTO_APPLY_RUN_LEASE_KEY]);
    if (isOwnedRunLease(refreshed[AUTO_APPLY_RUN_LEASE_KEY], message, sender)) {
      await storageSet({
        [AUTO_APPLY_RUN_LEASE_KEY]: {
          ...refreshed[AUTO_APPLY_RUN_LEASE_KEY],
          updatedAt: nowIso()
        }
      });
    }
    return { ok: true, ...(result || {}) };
  });
}

async function mutateUnscopedStateWithoutActiveRun(mutation) {
  return enqueueAutoApplyOwnership(async () => {
    const stored = await storageGet([AUTO_APPLY_RUN_LEASE_KEY]);
    if (stored[AUTO_APPLY_RUN_LEASE_KEY]?.active === true) {
      return { ok: false, ignored: true, reason: 'active_run_requires_scope' };
    }
    await mutation();
    return { ok: true };
  });
}

async function writeOwnedAutoApplyState(message, sender) {
  return mutateOwnedAutoApplyRun(message, sender, async () => {
    const patch = Object.fromEntries(Object.entries(message?.patch || {})
      .filter(([key]) => OWNED_AUTO_APPLY_STATE_KEYS.has(key)));
    if (Object.keys(patch).length === 0) {
      return { written: false, reason: 'empty_patch' };
    }
    await storageSet(patch);
    return { written: true };
  });
}

async function recordOwnedDailyApplication(message, sender) {
  return mutateOwnedAutoApplyRun(message, sender, async () => {
    const stored = await storageGet([DAILY_APPLICATION_LEDGER_KEY]);
    const { ledger, added } = updateDailyApplicationLedger(
      stored[DAILY_APPLICATION_LEDGER_KEY],
      message?.vacancyId,
      message?.kind,
      message?.counterBaseline
    );
    await storageSet({ [DAILY_APPLICATION_LEDGER_KEY]: ledger });
    return { recorded: true, ledger, added };
  });
}

async function registerAutoApplyResponseAttempt(message, sender) {
  return enqueueAutoApplyOwnership(async () => {
    const attempt = message?.attempt || {};
    const runId = normalizeRunId(message?.runId || attempt.runId);
    const vacancyId = String(attempt.vacancyId || '').trim();
    const ownerId = normalizeRunOwnerId(sender?.tab?.id);
    const responseVacancyId = (() => {
      try {
        return new URL(String(attempt.responseUrl || '')).searchParams.get('vacancyId') || '';
      } catch {
        return '';
      }
    })();
    const sourceIsSearch = (() => {
      try {
        const source = new URL(String(attempt.sourceUrl || ''));
        return /(^|\.)hh\.ru$/.test(source.hostname) && source.pathname === '/search/vacancy';
      } catch {
        return false;
      }
    })();
    const queue = message?.queue || {};
    const item = message?.item || {};
    const ownership = await storageGet([AUTO_APPLY_RUN_LEASE_KEY, AUTO_APPLY_RESPONSE_ATTEMPTS_KEY]);
    const lease = ownership[AUTO_APPLY_RUN_LEASE_KEY];
    const valid = Boolean(
      runId && vacancyId && ownerId &&
      lease?.active === true && normalizeRunId(lease.runId) === runId && normalizeRunOwnerId(lease.ownerId) === ownerId &&
      attempt.kind === 'direct_response_navigation' &&
      sourceIsSearch && String(queue.sourceUrl || '') === String(attempt.sourceUrl || '') &&
      normalizeRunId(queue.runId) === runId &&
      (!queue.ownerId || normalizeRunOwnerId(queue.ownerId) === ownerId) &&
      String(item.vacancyId || '') === vacancyId &&
      responseVacancyId === vacancyId &&
      attempt.targetResponseControlEnabledBefore === true &&
      attempt.alreadyAppliedBefore === false &&
      isFreshTimestamp(attempt.startedAt, AUTO_APPLY_RESPONSE_ATTEMPT_TTL_MS)
    );
    if (!valid) {
      return {
        ok: true,
        registered: false,
        stage: 'attempt_validation',
        reason: 'invalid_attempt_provenance'
      };
    }
    const key = responseAttemptStorageKey(runId, vacancyId, ownerId);
    const attempts = { ...(ownership[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY] || {}) };
    const registeredAt = nowIso();
    for (const [candidateKey, candidate] of Object.entries(attempts)) {
      if (
        candidateKey !== key &&
        normalizeRunId(candidate?.runId) === runId &&
        normalizeRunOwnerId(candidate?.ownerId) === ownerId &&
        !candidate?.finalizedAt &&
        !candidate?.cancelledAt
      ) {
        attempts[candidateKey] = { ...candidate, cancelledAt: registeredAt, cancelReason: 'superseded', supersededBy: key };
      }
    }
    attempts[key] = {
      ...attempt,
      key,
      runId,
      vacancyId,
      ownerId,
      finalizedAt: '',
      cancelledAt: '',
      queue: message.queue || null,
      item: message.item || null
    };
    const retained = Object.fromEntries(Object.entries(attempts)
      .filter(([, value]) => isFreshTimestamp(value?.startedAt, AUTO_APPLY_RESPONSE_ATTEMPT_TTL_MS))
      .slice(-40));
    await storageSet({ [AUTO_APPLY_RESPONSE_ATTEMPTS_KEY]: retained });
    return { ok: true, registered: true, attempt: retained[key] };
  });
}

async function getAutoApplyResponseAttempt(message, sender, { consume = false } = {}) {
  return enqueueAutoApplyOwnership(async () => {
    const runId = normalizeRunId(message?.runId);
    const vacancyId = String(message?.vacancyId || '').trim();
    const ownerId = normalizeRunOwnerId(sender?.tab?.id);
    if (!vacancyId || !ownerId) return { ok: true, found: false, status: 'missing' };
    const stored = await storageGet([
      AUTO_APPLY_RUN_LEASE_KEY,
      AUTO_APPLY_RESPONSE_ATTEMPTS_KEY,
      'autoApplyPendingSubmit'
    ]);
    const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
    if (
      lease?.active !== true ||
      normalizeRunOwnerId(lease.ownerId) !== ownerId ||
      (runId && normalizeRunId(lease.runId) !== runId)
    ) {
      return { ok: false, found: false, status: 'run_not_owned' };
    }
    const effectiveRunId = runId || normalizeRunId(lease.runId);
    const attempts = { ...(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY] || {}) };
    const candidates = Object.values(attempts).filter((attempt) => (
      String(attempt?.vacancyId || '') === vacancyId &&
      normalizeRunId(attempt?.runId) === effectiveRunId &&
      normalizeRunOwnerId(attempt?.ownerId) === ownerId &&
      !attempt?.cancelledAt
    ));
    const attempt = candidates.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))[0];
    if (!attempt) return { ok: true, found: false, status: 'missing' };
    if (!isFreshTimestamp(attempt.startedAt, AUTO_APPLY_RESPONSE_ATTEMPT_TTL_MS)) {
      return { ok: true, found: true, status: 'stale' };
    }
    if (attempt.finalizedAt) {
      return { ok: true, found: true, status: 'finalized', attempt };
    }
    if (consume) {
      attempts[attempt.key] = { ...attempt, finalizedAt: nowIso() };
      await storageSet({ [AUTO_APPLY_RESPONSE_ATTEMPTS_KEY]: attempts });
      return { ok: true, found: true, status: 'consumed', consumed: true, attempt: attempts[attempt.key] };
    }
    return { ok: true, found: true, status: 'ready', attempt };
  });
}

async function cancelAutoApplyResponseAttempt(message, sender) {
  return mutateOwnedAutoApplyRun(message, sender, async () => {
    const runId = normalizeRunId(message?.runId);
    const vacancyId = String(message?.vacancyId || '').trim();
    const ownerId = normalizeRunOwnerId(sender?.tab?.id);
    const stored = await storageGet([AUTO_APPLY_RESPONSE_ATTEMPTS_KEY, 'autoApplyQueue']);
    const attempts = { ...(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY] || {}) };
    const key = responseAttemptStorageKey(runId, vacancyId, ownerId);
    const attempt = attempts[key];
    if (!attempt) return { cancelled: false, status: 'missing' };
    if (attempt.finalizedAt) return { cancelled: false, status: 'finalized' };
    const cancelledAt = nowIso();
    attempts[key] = {
      ...attempt,
      cancelledAt,
      cancelReason: String(message?.reason || 'cancelled').slice(0, 120)
    };
    const queue = stored.autoApplyQueue;
    const queueAttemptMatches = normalizeRunId(queue?.runId) === runId &&
      String(queue?.responseAttempt?.vacancyId || '') === vacancyId;
    await storageSet({
      [AUTO_APPLY_RESPONSE_ATTEMPTS_KEY]: attempts,
      ...(queueAttemptMatches ? { autoApplyQueue: { ...queue, responseAttempt: null } } : {})
    });
    return { cancelled: true, status: 'cancelled' };
  });
}

async function finalizeAutoApplyResponseAttempt(message, sender) {
  return enqueueAutoApplyOwnership(async () => {
    const runId = normalizeRunId(message?.runId);
    const vacancyId = String(message?.vacancyId || '').trim();
    const ownerId = normalizeRunOwnerId(sender?.tab?.id);
    const stored = await storageGet([
      AUTO_APPLY_RUN_LEASE_KEY,
      AUTO_APPLY_RESPONSE_ATTEMPTS_KEY,
      DAILY_APPLICATION_LEDGER_KEY,
      'runResults',
      'runState',
      'autoApplyQueue',
      'autoApplyPendingSubmit'
    ]);
    const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
    if (!isOwnedRunLease(lease, message, sender) || !runId || !vacancyId || !ownerId) {
      return { ok: false, finalized: false, reason: 'run_not_owned' };
    }
    const key = responseAttemptStorageKey(runId, vacancyId, ownerId);
    const attempts = { ...(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY] || {}) };
    const attempt = attempts[key];
    if (!attempt) return { ok: true, finalized: false, status: 'missing' };
    if (attempt.cancelledAt) return { ok: true, finalized: false, status: 'cancelled' };
    if (attempt.finalizedAt) {
      return { ok: true, finalized: false, alreadyFinalized: true, status: 'finalized', attempt };
    }
    if (!isFreshTimestamp(attempt.startedAt, AUTO_APPLY_RESPONSE_ATTEMPT_TTL_MS)) {
      return { ok: true, finalized: false, status: 'stale' };
    }
    const result = {
      ...(message?.result || {}),
      vacancyId,
      timestamp: message?.result?.timestamp || nowIso()
    };
    const { ledger } = updateDailyApplicationLedger(
      stored[DAILY_APPLICATION_LEDGER_KEY],
      vacancyId,
      'submitted',
      message?.counters?.applied
    );
    const runResults = Array.isArray(stored.runResults) ? stored.runResults : [];
    const resultExists = runResults.some((entry) => (
      String(entry?.vacancyId || '') === vacancyId &&
      String(entry?.status || '') === String(result.status || '')
    ));
    const nextResults = resultExists
      ? runResults
      : [...runResults.slice(-(AUTO_APPLY_RUN_RESULTS_LIMIT - 1)), result];
    const counters = {
      found: 0,
      processed: 0,
      applied: 0,
      alreadyApplied: 0,
      skipped: 0,
      errors: 0,
      ...(message?.counters || {})
    };
    counters.applied = Math.max(Number(counters.applied) || 0, ledger.newSubmitted);
    counters.alreadyApplied = Math.max(Number(counters.alreadyApplied) || 0, ledger.alreadyApplied);
    counters.processed = Math.max(Number(counters.processed) || 0, nextResults.length);
    counters.found = Math.max(Number(counters.found) || 0, counters.processed);
    const finalizedAt = nowIso();
    attempts[key] = { ...attempt, finalizedAt, resultStatus: result.status || '' };
    const queue = stored.autoApplyQueue;
    const queueAttemptMatches = normalizeRunId(queue?.runId) === runId &&
      String(queue?.responseAttempt?.vacancyId || '') === vacancyId;
    const runState = {
      ...DEFAULTS.runState,
      ...(stored.runState || {}),
      ...counters,
      state: String(stored.runState?.state || 'applying'),
      currentAction: 'Отклик отправлен',
      lastError: '',
      updatedAt: finalizedAt
    };
    await storageSet({
      [AUTO_APPLY_RESPONSE_ATTEMPTS_KEY]: attempts,
      [DAILY_APPLICATION_LEDGER_KEY]: ledger,
      runResults: nextResults,
      runState,
      ...(queueAttemptMatches ? { autoApplyQueue: { ...queue, responseAttempt: null, counters } } : {}),
      ...(normalizeRunId(stored.autoApplyPendingSubmit?.runId) === runId &&
        String(stored.autoApplyPendingSubmit?.item?.vacancyId || '') === vacancyId
        ? { autoApplyPendingSubmit: null }
        : {})
    });
    if (!resultExists) {
      await appendAgentLog('run_result', result);
    }
    return { ok: true, finalized: true, status: 'finalized', attempt: attempts[key], ledger, counters, result };
  });
}

async function finalizeAutoApplyPendingSubmit(message, sender) {
  return enqueueAutoApplyOwnership(async () => {
    const runId = normalizeRunId(message?.runId);
    const ownerId = normalizeRunOwnerId(sender?.tab?.id);
    const vacancyId = String(message?.vacancyId || '').trim();
    const stored = await storageGet([
      AUTO_APPLY_RUN_LEASE_KEY,
      DAILY_APPLICATION_LEDGER_KEY,
      'autoApplyPendingSubmit',
      'autoApplyQueue',
      'runResults',
      'runState'
    ]);
    if (!isOwnedRunLease(stored[AUTO_APPLY_RUN_LEASE_KEY], message, sender)) {
      return { ok: false, finalized: false, reason: 'run_not_owned' };
    }
    const pending = stored.autoApplyPendingSubmit;
    const resultStatus = String(message?.result?.status || pending?.status || 'applied');
    const existingResult = (stored.runResults || []).find((entry) => (
      String(entry?.vacancyId || '') === vacancyId && String(entry?.status || '') === resultStatus
    ));
    if (!pending?.item) {
      return existingResult
        ? { ok: true, finalized: false, alreadyFinalized: true, result: existingResult }
        : { ok: true, finalized: false, status: 'missing' };
    }
    if (
      normalizeRunId(pending.runId) !== runId ||
      normalizeRunOwnerId(pending.ownerId) !== ownerId ||
      String(pending.item.vacancyId || '') !== vacancyId
    ) {
      return { ok: false, finalized: false, reason: 'pending_submit_not_owned' };
    }
    const result = {
      ...pending.item,
      ...(message?.result || {}),
      vacancyId,
      status: resultStatus,
      timestamp: message?.result?.timestamp || nowIso()
    };
    const { ledger } = updateDailyApplicationLedger(
      stored[DAILY_APPLICATION_LEDGER_KEY],
      vacancyId,
      'submitted',
      message?.counters?.applied
    );
    const runResults = Array.isArray(stored.runResults) ? stored.runResults : [];
    const nextResults = existingResult
      ? runResults
      : [...runResults.slice(-(AUTO_APPLY_RUN_RESULTS_LIMIT - 1)), result];
    const counters = {
      found: 0,
      processed: 0,
      applied: 0,
      alreadyApplied: 0,
      skipped: 0,
      errors: 0,
      ...(pending.counters || {}),
      ...(message?.counters || {})
    };
    counters.applied = Math.max(Number(counters.applied) || 0, ledger.newSubmitted);
    counters.alreadyApplied = Math.max(Number(counters.alreadyApplied) || 0, ledger.alreadyApplied);
    counters.processed = Math.max(Number(counters.processed) || 0, nextResults.length);
    counters.found = Math.max(Number(counters.found) || 0, counters.processed);
    const finalizedAt = nowIso();
    const queue = stored.autoApplyQueue;
    const queueMatches = normalizeRunId(queue?.runId) === runId;
    await storageSet({
      [DAILY_APPLICATION_LEDGER_KEY]: ledger,
      autoApplyPendingSubmit: null,
      runResults: nextResults,
      runState: {
        ...DEFAULTS.runState,
        ...(stored.runState || {}),
        ...counters,
        runId,
        ownerId,
        updatedAt: finalizedAt
      },
      ...(queueMatches ? { autoApplyQueue: { ...queue, counters } } : {})
    });
    return { ok: true, finalized: true, ledger, counters, result };
  });
}

function processedCountForRetainedResults(runResults, ...candidates) {
  const retained = Array.isArray(runResults) ? runResults.length : 0;
  if (retained < AUTO_APPLY_RUN_RESULTS_LIMIT) return retained;
  return Math.max(retained, ...candidates.map((value) => safeStatusCount(value)));
}

async function guardScheduledTerminalTransition(message, lease) {
  const state = String(message?.patch?.state || '');
  if (!['complete', 'idle', 'dry_run_complete', 'stopped', 'paused', 'error'].includes(state)) {
    return { allowed: true };
  }
  const stored = await storageGet([
    SCHEDULED_AUTO_APPLY_SESSION_KEY,
    AUTO_APPLY_RESPONSE_ATTEMPTS_KEY,
    'autoApplyPendingSubmit',
    'autoApplyQueue',
    'autoApplySearchQueue',
    'runState',
    'runResults'
  ]);
  const session = stored[SCHEDULED_AUTO_APPLY_SESSION_KEY];
  const runId = normalizeRunId(lease?.runId);
  const ownerId = normalizeRunOwnerId(lease?.ownerId);
  if (
    session?.state !== 'running' ||
    normalizeRunId(session.runId) !== runId ||
    normalizeRunOwnerId(session.ownerId) !== ownerId
  ) return { allowed: true };

  const belongsToOwnedRun = (value) => {
    const valueRunId = normalizeRunId(value?.runId);
    const valueOwnerId = normalizeRunOwnerId(value?.ownerId);
    return (!valueRunId && !valueOwnerId) || (valueRunId === runId && valueOwnerId === ownerId);
  };
  const pendingSubmit = Boolean(
    stored.autoApplyPendingSubmit?.item && belongsToOwnedRun(stored.autoApplyPendingSubmit)
  );
  const unresolvedAttempt = Object.values(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY] || {}).some((attempt) => (
    !attempt?.finalizedAt && !attempt?.cancelledAt && belongsToOwnedRun(attempt)
  ));
  const activeQueue = [stored.autoApplyQueue, stored.autoApplySearchQueue].some((queue) => (
    queue?.active === true && (
      belongsToOwnedRun(queue) || String(queue.scheduledSessionId || '') === String(session.sessionId || '')
    )
  ));
  const runResults = Array.isArray(stored.runResults) ? stored.runResults : [];
  const processedSource = Object.hasOwn(message?.patch || {}, 'processed')
    ? message.patch.processed
    : stored.runState?.processed;
  const processedNumber = Number(processedSource);
  const processed = Number.isFinite(processedNumber) && processedNumber >= 0
    ? Math.floor(processedNumber)
    : 0;
  const expectedRetainedResults = Math.min(processed, AUTO_APPLY_RUN_RESULTS_LIMIT);
  const counterMismatch = expectedRetainedResults !== runResults.length;
  if (!pendingSubmit && !unresolvedAttempt && !activeQueue && !counterMismatch) {
    return { allowed: true };
  }

  const reason = pendingSubmit
    ? 'unresolved_submit'
    : unresolvedAttempt
      ? 'unresolved_response_attempt'
      : activeQueue
        ? 'active_saved_queue'
        : 'counter_result_mismatch';
  if (!pendingSubmit && !unresolvedAttempt && !activeQueue) {
    await terminalizeScheduledRepairSession({ ...stored, [AUTO_APPLY_RUN_LEASE_KEY]: lease }, session, reason);
    return { allowed: false, terminalDeferred: true, reason };
  }

  const timestamp = new Date(schedulerNowMs()).toISOString();
  const reviewIssues = [...new Set([
    ...(Array.isArray(session.reviewIssues) ? session.reviewIssues : []),
    reason
  ])].slice(0, 20);
  await storageSet({
    autoApplyStopRequested: true,
    autoApplyStopRequestedAt: timestamp,
    autoApplyStopReason: 'repair_pending',
    runState: {
      ...DEFAULTS.runState,
      ...(stored.runState || {}),
      state: 'paused',
      runId,
      ownerId,
      processed: processedCountForRetainedResults(
        runResults,
        stored.runState?.processed,
        message?.patch?.processed
      ),
      currentAction: 'Приостановлено: терминальное состояние не подтверждено',
      lastError: reason,
      updatedAt: timestamp
    },
    [AUTO_APPLY_RUN_LEASE_KEY]: {
      ...lease,
      scheduledRepairPending: true,
      updatedAt: timestamp
    },
    [SCHEDULED_AUTO_APPLY_SESSION_KEY]: {
      ...session,
      state: 'repair_pending',
      repairFromVersion: getSafeManifestVersion(),
      stopReason: 'repair_pending',
      reviewIssues,
      updatedAt: timestamp,
      reviewRequired: true
    }
  });
  return { allowed: false, terminalDeferred: true, reason };
}

async function syncScheduledSessionForTerminalRun(message, lease) {
  const state = String(message?.patch?.state || '');
  if (!['complete', 'idle', 'dry_run_complete', 'stopped', 'paused', 'error'].includes(state)) return;
  const stored = await storageGet([SCHEDULED_AUTO_APPLY_SESSION_KEY, 'autoApplyStopReason']);
  const session = stored[SCHEDULED_AUTO_APPLY_SESSION_KEY];
  if (
    !session ||
    normalizeRunId(session.runId) !== normalizeRunId(lease?.runId) ||
    normalizeRunOwnerId(session.ownerId) !== normalizeRunOwnerId(lease?.ownerId)
  ) return;
  if (session.state === 'repair_pending') return;
  const timestamp = new Date(schedulerNowMs()).toISOString();
  const sessionState = ['complete', 'dry_run_complete'].includes(state)
    ? 'complete'
    : state === 'error'
      ? 'error'
      : 'blocked';
  await storageSet({
    [SCHEDULED_AUTO_APPLY_SESSION_KEY]: {
      ...session,
      state: sessionState,
      stopReason: sessionState === 'complete'
        ? ''
        : String(stored.autoApplyStopReason || message?.patch?.lastError || state).slice(0, 80),
      updatedAt: timestamp,
      finishedAt: timestamp,
      reviewRequired: true
    }
  });
}

async function releaseAutoApplyRunLeaseIfTerminalUnlocked(message, sender) {
  const state = String(message?.patch?.state || '');
  if (!['complete', 'idle', 'dry_run_complete', 'stopped', 'paused', 'error'].includes(state)) return;
  const runId = normalizeRunId(message?.runId);
  const ownerId = normalizeRunOwnerId(sender?.tab?.id);
  const stored = await storageGet([
    AUTO_APPLY_RUN_LEASE_KEY,
    AUTO_APPLY_RESPONSE_ATTEMPTS_KEY,
    'autoApplyPendingSubmit',
    SCHEDULED_AUTO_APPLY_SESSION_KEY
  ]);
  const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
  if (normalizeRunId(lease?.runId) !== runId || normalizeRunOwnerId(lease?.ownerId) !== ownerId) return;
  const scheduledSession = stored[SCHEDULED_AUTO_APPLY_SESSION_KEY];
  if (
    state === 'paused' &&
    scheduledSession?.state === 'repair_pending' &&
    normalizeRunId(scheduledSession.runId) === runId &&
    normalizeRunOwnerId(scheduledSession.ownerId) === ownerId
  ) return;
  const ownedUnresolvedAttempts = Object.values(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY] || {}).filter((attempt) => (
    normalizeRunId(attempt?.runId) === runId &&
    normalizeRunOwnerId(attempt?.ownerId) === ownerId &&
    !attempt?.finalizedAt &&
    !attempt?.cancelledAt
  ));
  const hasFreshUnresolvedAttempt = ownedUnresolvedAttempts.some((attempt) => (
    isFreshTimestamp(attempt?.startedAt, AUTO_APPLY_RESPONSE_ATTEMPT_TTL_MS)
  ));
  const senderUrl = String(sender?.tab?.url || '');
  const senderVacancyId = getVacancyIdFromUrl(senderUrl);
  const hasStaleAttemptAtMatchingDestination = ownedUnresolvedAttempts.some((attempt) => {
    if (isFreshTimestamp(attempt?.startedAt, AUTO_APPLY_RESPONSE_ATTEMPT_TTL_MS)) return false;
    const attemptVacancyId = String(attempt?.vacancyId || '');
    const isMatchingVacancyDestination = senderVacancyId && senderVacancyId === attemptVacancyId &&
      (isHhResponseFormUrl(senderUrl) || isHhVacancyDetailUrl(senderUrl));
    return senderUrl === String(attempt?.responseUrl || '') || isMatchingVacancyDestination;
  });
  const hasOwnedPendingSubmit = normalizeRunId(stored.autoApplyPendingSubmit?.runId) === runId &&
    normalizeRunOwnerId(stored.autoApplyPendingSubmit?.ownerId) === ownerId;
  if (
    ['stopped', 'paused'].includes(state) &&
    (hasFreshUnresolvedAttempt || hasStaleAttemptAtMatchingDestination || hasOwnedPendingSubmit)
  ) {
    return;
  }
  const releasedAt = nowIso();
  const attempts = Object.fromEntries(Object.entries(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY] || {}).map(([key, attempt]) => {
    if (
      normalizeRunId(attempt?.runId) === runId &&
      normalizeRunOwnerId(attempt?.ownerId) === ownerId &&
      !attempt?.finalizedAt &&
      !attempt?.cancelledAt
    ) {
      return [key, { ...attempt, cancelledAt: releasedAt, cancelReason: `run_${state}` }];
    }
    return [key, attempt];
  }));
  await storageSet({
    [AUTO_APPLY_RESPONSE_ATTEMPTS_KEY]: attempts,
    [AUTO_APPLY_RUN_LEASE_KEY]: {
      ...lease,
      active: false,
      updatedAt: releasedAt,
      releasedState: state
    }
  });
}

function getMoscowStatusDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

function safeStatusCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(Math.floor(count), 1000000);
}

function safeStatusTimestamp(value) {
  const timestamp = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(timestamp) && Math.abs(timestamp) <= 8.64e15
    ? new Date(timestamp).toISOString()
    : '';
}

function safeStatusRunState(value) {
  const state = String(value?.state || '');
  return SAFE_STATUS_RUN_STATES.has(state) ? state : 'unknown';
}

function buildSafeDailyLedger(value, now = new Date()) {
  const date = getMoscowStatusDate(now);
  if (!value || typeof value !== 'object' || value.date !== date) {
    return {
      date,
      newSubmitted: 0,
      alreadyApplied: 0,
      hhDailyLimitReached: false,
      updatedAt: ''
    };
  }

  const submittedIds = Array.isArray(value.submittedVacancyIds) ? value.submittedVacancyIds : [];
  const alreadyAppliedIds = Array.isArray(value.alreadyAppliedVacancyIds) ? value.alreadyAppliedVacancyIds : [];
  const submittedCount = Math.min(submittedIds.length, 1000000);
  const alreadyAppliedCount = Math.min(alreadyAppliedIds.length, 1000000);
  return {
    date,
    newSubmitted: Math.min(safeStatusCount(value.legacySubmitted) + submittedCount, 1000000),
    alreadyApplied: alreadyAppliedCount,
    hhDailyLimitReached: value.hhDailyLimitReached === true,
    updatedAt: safeStatusTimestamp(value.updatedAt)
  };
}

function buildSafeAutomationAudit(value) {
  if (!value || typeof value !== 'object') {
    return { ready: false, checkedAt: '', issues: ['audit_unavailable'] };
  }

  const checkedAt = safeStatusTimestamp(value.checkedAt);
  const rawIssues = Array.isArray(value.issues) ? value.issues : [];
  const safeIssues = rawIssues.filter((issue) => SAFE_AUTOMATION_AUDIT_ISSUES.has(issue));
  const hasUnsafeIssue = rawIssues.some((issue) => !SAFE_AUTOMATION_AUDIT_ISSUES.has(issue));
  if (hasUnsafeIssue) safeIssues.push('audit_invalid');

  const ready = value.ready === true && checkedAt !== '' && rawIssues.length === 0;
  if (!ready && safeIssues.length === 0) {
    safeIssues.push(checkedAt ? 'audit_not_ready' : 'audit_unavailable');
  }
  return {
    ready,
    checkedAt,
    issues: [...new Set(safeIssues)]
  };
}

function buildSafeStopBeforeSubmitState(value, runState) {
  if (!value || typeof value !== 'object' || value.armed !== true) {
    return { state: 'absent' };
  }
  const expiresAt = Date.parse(String(value.expiresAt || ''));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return { state: 'expired' };
  }
  const runId = typeof value.runId === 'string' ? value.runId.trim() : '';
  if (!runId) return { state: 'armed' };
  return {
    state: new Set([
      'scanning',
      'applying',
      'waiting_for_dialog',
      'generating_cover_letter',
      'filling_cover_letter',
      'submitting',
      'refreshing_resumes'
    ]).has(safeStatusRunState(runState)) ? 'current' : 'other'
  };
}

function buildSafeRunState(value) {
  return {
    state: safeStatusRunState(value),
    found: safeStatusCount(value?.found),
    processed: safeStatusCount(value?.processed),
    applied: safeStatusCount(value?.applied),
    alreadyApplied: safeStatusCount(value?.alreadyApplied),
    skipped: safeStatusCount(value?.skipped),
    errors: safeStatusCount(value?.errors),
    updatedAt: safeStatusTimestamp(value?.updatedAt)
  };
}

function buildSafeStartDigest(value) {
  const lastEvent = String(value?.lastEvent || 'none');
  return {
    starts: safeStatusCount(value?.starts),
    continues: safeStatusCount(value?.continues),
    shortcutStarts: safeStatusCount(value?.shortcutStarts),
    shortcutContinues: safeStatusCount(value?.shortcutContinues),
    duplicates: safeStatusCount(value?.duplicates),
    conflicts: safeStatusCount(value?.conflicts),
    lastEvent: SAFE_START_DIGEST_EVENTS.has(lastEvent) ? lastEvent : 'none',
    updatedAt: safeStatusTimestamp(value?.updatedAt)
  };
}

function buildSafeScheduledSession(value) {
  if (!value || typeof value !== 'object') {
    return {
      present: false,
      sessionId: '',
      dateMsk: '',
      state: 'none',
      extensionVersion: '',
      startedAt: '',
      updatedAt: '',
      finishedAt: '',
      repairAttempts: 0,
      stopReason: '',
      reviewRequired: false,
      reviewPending: false,
      reviewOutcome: '',
      reviewIssueCount: 0,
      reviewedAt: ''
    };
  }
  const rawSessionId = String(value.sessionId || '');
  const state = SCHEDULED_AUTO_APPLY_SESSION_STATES.has(value.state) ? value.state : 'error';
  const safeStopReasons = new Set([
    '',
    'user_stop',
    'repair_pending',
    'daily_limit_reached',
    'authentication_required',
    'parallel_run_conflict',
    'scheduled_start_rejected',
    'audit_not_ready',
    'missing_checkpoint',
    'max_repair_attempts',
    'repair_cutoff',
    'date_mismatch',
    'version_not_advanced',
    'unresolved_submit',
    'unresolved_response_attempt',
    'active_saved_queue',
    'counter_result_mismatch',
    'owner_missing',
    'owner_tab_closed'
  ]);
  const stopReason = safeStopReasons.has(value.stopReason) ? value.stopReason : (value.stopReason ? 'other' : '');
  const reviewOutcome = ['passed', 'blocked'].includes(value.reviewOutcome) ? value.reviewOutcome : '';
  const reviewedAt = safeStatusTimestamp(value.reviewedAt);
  return {
    present: true,
    sessionId: /^[A-Za-z0-9:._-]{1,200}$/.test(rawSessionId) ? rawSessionId : '',
    dateMsk: /^\d{4}-\d{2}-\d{2}$/.test(String(value.dateMsk || '')) ? value.dateMsk : '',
    state,
    extensionVersion: /^\d+(?:\.\d+){0,3}$/.test(String(value.extensionVersion || '')) ? value.extensionVersion : '',
    startedAt: safeStatusTimestamp(value.startedAt),
    updatedAt: safeStatusTimestamp(value.updatedAt),
    finishedAt: safeStatusTimestamp(value.finishedAt),
    repairAttempts: Math.min(safeStatusCount(value.repairAttempts), 10),
    stopReason,
    reviewRequired: value.reviewRequired === true,
    reviewPending: SCHEDULED_AUTO_APPLY_TERMINAL_STATES.has(state) && value.reviewRequired === true && !reviewedAt,
    reviewOutcome,
    reviewIssueCount: Math.min(Array.isArray(value.reviewIssues) ? value.reviewIssues.length : 0, 100),
    reviewedAt
  };
}

async function buildSafeScheduledStatus(value, session) {
  const settings = scheduledSettings(value);
  let nextAlarmAt = '';
  try {
    const alarm = await chrome.alarms?.get?.(SCHEDULED_AUTO_APPLY_ALARM);
    nextAlarmAt = safeStatusTimestamp(alarm?.scheduledTime);
  } catch {
    nextAlarmAt = '';
  }
  return {
    enabled: settings.enabled,
    timeMsk: settings.timeMsk,
    lateWindowMinutes: settings.lateWindowMinutes,
    maxRepairAttempts: settings.maxRepairAttempts,
    repairCutoffMsk: settings.repairCutoffMsk,
    filterConfigured: Boolean(settings.filterUrl),
    nextAlarmAt,
    reviewGateBlocked: isPendingScheduledReview(session)
  };
}

function getSafeManifestVersion() {
  try {
    const version = String(chrome.runtime?.getManifest?.().version || '');
    return /^\d+(?:\.\d+){0,3}$/.test(version) ? version : '';
  } catch {
    return '';
  }
}

async function buildSafeStatusSnapshot() {
  const state = await storageGet([
    DAILY_APPLICATION_LEDGER_KEY,
    'automationSettingsAudit',
    'autoApplyStopBeforeSubmit',
    'runState',
    AUTOMATION_START_DIGEST_KEY,
    ...SCHEDULED_AUTO_APPLY_SETTING_KEYS,
    SCHEDULED_AUTO_APPLY_SESSION_KEY
  ]);
  return {
    manifestVersion: getSafeManifestVersion(),
    dailyLedger: buildSafeDailyLedger(state[DAILY_APPLICATION_LEDGER_KEY]),
    automationAudit: buildSafeAutomationAudit(state.automationSettingsAudit),
    stopBeforeSubmit: buildSafeStopBeforeSubmitState(
      state.autoApplyStopBeforeSubmit,
      state.runState
    ),
    runState: buildSafeRunState(state.runState),
    startDigest: buildSafeStartDigest(state[AUTOMATION_START_DIGEST_KEY]),
    schedule: await buildSafeScheduledStatus(state, state[SCHEDULED_AUTO_APPLY_SESSION_KEY]),
    scheduledSession: buildSafeScheduledSession(state[SCHEDULED_AUTO_APPLY_SESSION_KEY])
  };
}

async function runSafeStatusPreflight() {
  await ensureDefaults({ preserveAutomationState: true });
  const { aiEnabled = DEFAULTS.aiEnabled } = await storageGet(['aiEnabled']);
  const profileRefreshAttempted = aiEnabled !== false;
  if (profileRefreshAttempted) {
    // Same profile refresh used by live start, without quota/run-state fallback writes.
    await ensureResumeProfileAutoRefresh({ suppressAiFallback: true }).catch(() => null);
  }
  await buildAutomationSettingsAudit();
  return {
    snapshot: await buildSafeStatusSnapshot(),
    preflight: {
      profileRefreshAttempted,
      auditRefreshed: true
    }
  };
}

async function assertAiEnabled() {
  const { aiEnabled = DEFAULTS.aiEnabled } = await storageGet(['aiEnabled']);
  if (aiEnabled === false) {
    throw aiProviderError('ИИ выключен в настройках', 'HHJA_AI_DISABLED', false);
  }
}

async function appendAgentLog(event, details = {}) {
  await globalThis.HHJobAssistantLog?.append?.('background', event, details);
}

async function ensureDefaults({ preserveAutomationState = false } = {}) {
  const logApi = globalThis.HHJobAssistantLog;
  const logStateKeys = [
    logApi?.INDEX_KEY,
    logApi?.ACTIVE_RUN_KEY,
    ...(logApi?.LEGACY_KEYS || [])
  ].filter(Boolean);
  const current = await storageGet([
    ...Object.keys(DEFAULTS),
    'aiFallbackEnabled',
    'groqApiKey',
    ...logStateKeys
  ]);
  const patch = {};
  const promptKeys = new Set(['fallbackCoverLetterTemplate', 'coverPrompt', 'employerQuestionPrompt']);

  const credentials = AI_PROVIDERS.normalizeCredentials(current.aiProviderCredentials, current.groqApiKey);
  if (current.aiProvider === undefined) {
    patch.aiProvider = credentials.groq?.apiKey ? 'groq' : DEFAULTS.aiProvider;
  } else {
    patch.aiProvider = AI_PROVIDERS.normalizeProviderId(current.aiProvider);
  }
  if (JSON.stringify(credentials) !== JSON.stringify(current.aiProviderCredentials || {})) {
    patch.aiProviderCredentials = credentials;
  }
  if (credentials.groq?.apiKey && current.groqApiKey !== credentials.groq.apiKey) {
    patch.groqApiKey = credentials.groq.apiKey;
  }
  const normalizedPrimaryProvider = patch.aiProvider || current.aiProvider || DEFAULTS.aiProvider;
  const fallbackProvider = AI_PROVIDERS.normalizeFallbackProvider(current, normalizedPrimaryProvider);
  if (current.aiFallbackProvider !== fallbackProvider) {
    patch.aiFallbackProvider = fallbackProvider;
  }
  const cooldowns = current.aiProviderCooldowns && typeof current.aiProviderCooldowns === 'object'
    ? { ...current.aiProviderCooldowns }
    : {};
  if (current.groqCooldownUntil && !cooldowns.groq) cooldowns.groq = current.groqCooldownUntil;
  if (JSON.stringify(cooldowns) !== JSON.stringify(current.aiProviderCooldowns || {})) {
    patch.aiProviderCooldowns = cooldowns;
  }

  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (
      !(preserveAutomationState && AUTOMATION_STATE_DEFAULT_KEYS.has(key)) &&
      key !== 'aiProvider' &&
      key !== 'aiFallbackProvider' &&
      key !== 'aiProviderCredentials' &&
      key !== 'aiProviderCooldowns' &&
      (current[key] === undefined || (promptKeys.has(key) && !String(current[key] || '').trim()))
    ) {
      patch[key] = value;
    }
  }

  if (current.dailyLimit === 10 || current.dailyLimit === 100) {
    patch.dailyLimit = DEFAULTS.dailyLimit;
  }
  if (current.resumeProfileAutoRefreshEnabled === false) {
    patch.resumeProfileAutoRefreshEnabled = true;
  }
  if (current.agentDebugRetentionCount === 5) {
    patch.agentDebugRetentionCount = DEFAULTS.agentDebugRetentionCount;
  }
  if (current.agentDebugLogsEnabled === false) {
    patch.agentDebugLogsEnabled = true;
  }

  if (OLD_DEFAULT_COVER_PROMPTS.has(current.coverPrompt)) {
    patch.coverPrompt = DEFAULTS.coverPrompt;
  }

  if (OLD_DEFAULT_EMPLOYER_QUESTION_PROMPTS.has(current.employerQuestionPrompt)) {
    patch.employerQuestionPrompt = DEFAULTS.employerQuestionPrompt;
  }

  if (isUnsafeEmployerQuestionPrompt(current.employerQuestionPrompt)) {
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

  const legacyLogKeys = (logApi?.LEGACY_KEYS || []).filter((key) => current[key] !== undefined);
  if (legacyLogKeys.length > 0) {
    await storageRemove(legacyLogKeys);
  }

  if (
    current.agentDebugLogsEnabled !== true &&
    (current[logApi?.INDEX_KEY] !== undefined || current[logApi?.ACTIVE_RUN_KEY] !== undefined)
  ) {
    await logApi?.clearHistory?.();
  } else if (
    current.agentDebugLogsEnabled === true &&
    Array.isArray(current[logApi?.INDEX_KEY]) &&
    current[logApi.INDEX_KEY].length > (patch.agentDebugRetentionCount || current.agentDebugRetentionCount || DEFAULTS.agentDebugRetentionCount)
  ) {
    await logApi?.trimHistory?.(patch.agentDebugRetentionCount || current.agentDebugRetentionCount);
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
      ...runResults.slice(-(AUTO_APPLY_RUN_RESULTS_LIMIT - 1)),
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
  const safeEmployerQuestionPrompt = sanitizeEmployerQuestionPrompt(employerQuestionPrompt);
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
          safeEmployerQuestionPrompt,
          '',
          'Резюме кандидата:',
          resumeText || '(резюме не указано)',
          '',
          'Точные данные кандидата:',
          candidateFacts?.age ? `Возраст: ${candidateFacts.age} лет` : 'Возраст: точные данные отсутствуют',
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
  if (document.querySelector(
    '[data-qa="resume-access-denied"], [data-qa="resume-access-denied-signin-button"], [data-qa="resume-access-denied-signup-button"]'
  )) {
    return { ok: false, error: 'Войдите в hh.ru, чтобы открыть резюме', text: '' };
  }
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
    throw aiProviderError('AI-провайдер вернул некорректный JSON профиля резюме', 'HHJA_AI_PROVIDER_INVALID_OUTPUT', true);
  }
  if (typeof parsed?.profile !== 'string' || (parsed.weaknesses !== undefined && (!Array.isArray(parsed.weaknesses) || parsed.weaknesses.some(item => typeof item !== 'string')))) {
    throw aiProviderError('AI-провайдер вернул неверную структуру профиля резюме', 'HHJA_AI_PROVIDER_INVALID_OUTPUT', true);
  }
  const profile = cleanPlainText(parsed?.profile).slice(0, RESUME_PROFILE_MAX_CHARS);
  if (profile.length < 40) {
    throw aiProviderError('AI-провайдер вернул слишком короткий профиль резюме', 'HHJA_AI_PROVIDER_INVALID_OUTPUT', true);
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

async function callResumeProfileModel({ sourceText = '', currentProfile = '', editComment = '', mode = 'build', deadlineAt: requestedDeadline }) {
  const {
    aiEnabled = DEFAULTS.aiEnabled,
    aiProvider,
    aiProviderCredentials = {},
    aiFallbackProvider,
    aiFallbackEnabled,
    aiFallbackToGroq = false,
    groqApiKey
  } = await storageGet([
    'aiEnabled',
    'aiProvider',
    'aiProviderCredentials',
    'aiFallbackProvider',
    'aiFallbackEnabled',
    'aiFallbackToGroq',
    'groqApiKey',
  ]);
  if (aiEnabled === false) {
    throw aiProviderError('ИИ выключен в настройках', 'HHJA_AI_DISABLED', false);
  }
  const settings = {
    aiProvider,
    aiProviderCredentials,
    aiFallbackProvider,
    aiFallbackEnabled,
    aiFallbackToGroq,
    groqApiKey
  };
  const primaryProviderId = AI_PROVIDERS.normalizeProviderId(aiProvider);
  const primaryProvider = AI_PROVIDERS.getProvider(primaryProviderId);
  const primaryApiKey = AI_PROVIDERS.getApiKey(settings, primaryProviderId);
  if (!primaryProvider.local && !primaryApiKey) {
    throw aiProviderError(`Ключ ${primaryProvider.label} API не настроен`, 'HHJA_AI_PROVIDER_NOT_CONFIGURED', false);
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
  const logDetails = {
      sourceLength: String(sourceText).length,
      sourceHash: sourceText ? hashText(sourceText) : '',
      profileLength: String(currentProfile).length,
      profileHash: currentProfile ? hashText(currentProfile) : '',
      commentLength: String(editComment).length,
      commentHash: editComment ? hashText(editComment) : ''
  };

  const deadlineAt = Math.min(Number(requestedDeadline) || Infinity, AI_PROVIDERS.createOperationDeadline(settings, task));
  const runProvider = async (providerId, apiKey) => {
    for (let attempt = 1; attempt <= RESUME_PROFILE_MODEL_ATTEMPTS; attempt += 1) {
      try {
        const completion = await executeAiProviderRequest({
          providerId,
          apiKey,
          task,
          messages,
          logDetails,
          attempt,
          maxAttempts: RESUME_PROFILE_MODEL_ATTEMPTS,
          deadlineAt
        });
        parseResumeProfileResponse(completion.content, { includeWeaknesses: mode !== 'edit' });
        return completion.content;
      } catch (error) {
        if (
          attempt < RESUME_PROFILE_MODEL_ATTEMPTS &&
          error?.code === 'HHJA_AI_PROVIDER_INVALID_OUTPUT'
        ) {
          continue;
        }
        if (providerId === 'groq' && error?.code === 'HHJA_AI_PROVIDER_INVALID_OUTPUT') {
          error.code = 'HHJA_GROQ_PROFILE_INVALID_RESPONSE';
        }
        throw error;
      }
    }
    throw aiProviderError('AI-провайдер вернул пустой профиль резюме', 'HHJA_AI_PROVIDER_INVALID_OUTPUT', true);
  };

  try {
    const content = await runProvider(primaryProviderId, primaryApiKey);
    await appendAgentLog('resume_profile_request_complete', {
      provider: primaryProviderId,
      task,
      responseLength: content.length,
      responseHash: hashText(content),
    });
    return content;
  } catch (error) {
    const fallbackProviderId = AI_PROVIDERS.normalizeFallbackProvider(settings, primaryProviderId);
    const fallbackApiKey = fallbackProviderId
      ? AI_PROVIDERS.getApiKey(settings, fallbackProviderId)
      : '';
    if (
      !fallbackProviderId ||
      (!AI_PROVIDERS.getProvider(fallbackProviderId || 'qwen').local && !fallbackApiKey) ||
      error?.aiFallbackEligible !== true
    ) {
      throw error;
    }
    await appendAgentLog('ai_provider_fallback_start', {
      task,
      fromProvider: primaryProviderId,
      toProvider: fallbackProviderId,
      reason: error.code || 'HHJA_AI_PROVIDER_ERROR'
    });
    const content = await runProvider(fallbackProviderId, fallbackApiKey);
    await appendAgentLog('ai_provider_fallback_complete', {
      task,
      fromProvider: primaryProviderId,
      toProvider: fallbackProviderId,
      reason: error.code || 'HHJA_AI_PROVIDER_ERROR'
    });
    return content;
  }
}

async function buildResumeProfileFromSource(sourceText, { checkedAt = nowIso(), deadlineAt } = {}) {
  const source = String(sourceText || '').slice(0, 12000);
  if (!source.trim()) throw new Error('Резюме пустое или не удалось прочитать его текст');
  const parsed = parseResumeProfileResponse(await callResumeProfileModel({ sourceText: source, mode: 'build', deadlineAt }));
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

async function buildResumeProfile({ deadlineAt } = {}) {
  await assertAiEnabled();
  const source = await getResumeContext({ forceRefresh: true });
  return buildResumeProfileFromSource(source, { deadlineAt });
}

async function editResumeProfile(editComment, { deadlineAt } = {}) {
  await assertAiEnabled();
  const { resumeProfileText = '' } = await storageGet(['resumeProfileText']);
  if (!String(resumeProfileText).trim()) throw new Error('Сначала заполните промпт с резюме');
  if (!String(editComment).trim()) throw new Error('Напишите, что нужно изменить в промпте');
  const parsed = parseResumeProfileResponse(await callResumeProfileModel({
    currentProfile: resumeProfileText,
    editComment,
    mode: 'edit',
    deadlineAt
  }), { includeWeaknesses: false });
  const patch = { resumeProfileText: parsed.profile, resumeProfileBuiltAt: nowIso() };
  await storageSet(patch);
  return patch;
}

async function ensureResumeProfileAutoRefresh({ suppressAiFallback = false, deadlineAt } = {}) {
  await assertAiEnabled();
  const current = await storageGet([
    'resumeProfileText',
    'resumeProfileSourceHash',
    'resumeProfileCheckedAt',
    'resumeProfileAutoRefreshEnabled',
    'resumeCacheTtlHours',
    'resumeCandidateFacts'
  ]);
  const factsValid = normalizeResumeCandidateFacts(current.resumeCandidateFacts, current.resumeProfileSourceHash || '');
  const profileAvailable = Boolean(String(current.resumeProfileText || '').trim());
  if (profileAvailable && !current.resumeProfileAutoRefreshEnabled && factsValid) return current;
  const ttlHours = Math.max(0.1, Math.min(Number(current.resumeCacheTtlHours) || DEFAULTS.resumeCacheTtlHours, 168));
  const ageMs = Date.now() - Date.parse(current.resumeProfileCheckedAt || 0);
  if (profileAvailable && factsValid && Number.isFinite(ageMs) && ageMs < ttlHours * 60 * 60 * 1000) return current;
  if (resumeProfileRefreshPromise) return resumeProfileRefreshPromise;

  resumeProfileRefreshPromise = (async () => {
    try {
      const source = await getResumeContext({ forceRefresh: true });
      await alignExpectedSalaryWithResume(source);
      const sourceHash = hashText(source);
      const checkedAt = nowIso();
      if (current.resumeProfileText && current.resumeProfileSourceHash === sourceHash) {
        await storageSet({ resumeProfileCheckedAt: checkedAt });
        await appendAgentLog('resume_profile_auto_refresh', { changed: false, sourceHash, checkedAt });
        return { ...current, resumeProfileCheckedAt: checkedAt };
      }
      const updated = await buildResumeProfileFromSource(source, { checkedAt, deadlineAt });
      await appendAgentLog('resume_profile_auto_refresh', { changed: true, sourceHash, checkedAt });
      return { ...current, ...updated };
    } catch (error) {
      await appendAgentLog('resume_profile_auto_refresh_error', { errorCode: error.code, provider: error.provider, task: error.task, httpStatus: error.httpStatus });
      throw error;
    } finally {
      resumeProfileRefreshPromise = null;
    }
  })();
  return resumeProfileRefreshPromise;
}

function normalizeComparableMoney(value) {
  const groups = String(value || '').match(/\d+/g) || [];
  const candidates = groups
    .map((group, index) => Number(groups.slice(index, index + 3).join('')))
    .filter((amount) => Number.isFinite(amount) && amount >= 50000 && amount <= 10000000);
  return candidates[0] || null;
}

function extractResumeSalaryAmount(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const salaryLine = lines.find((line) => (
    /(?:зарплат|доход|на\s+руки|gross|net|₽|руб)/i.test(line) &&
    normalizeComparableMoney(line)
  ));
  return normalizeComparableMoney(salaryLine || '');
}

async function alignExpectedSalaryWithResume(resumeText) {
  const resumeSalary = extractResumeSalaryAmount(resumeText);
  if (!resumeSalary) return { changed: false, salaryAvailable: false };
  const { expectedSalary = '' } = await storageGet(['expectedSalary']);
  if (normalizeComparableMoney(expectedSalary) === resumeSalary) {
    return { changed: false, salaryAvailable: true };
  }
  await storageSet({ expectedSalary: String(resumeSalary) });
  await appendAgentLog('resume_settings_auto_aligned', {
    expectedSalaryChanged: true,
    resumeSalaryHash: hashText(String(resumeSalary))
  });
  return { changed: true, salaryAvailable: true };
}

function hasConfiguredResumeContact(text) {
  return /(?:https?:\/\/)?t\.me\/[a-z0-9_]+|@[a-z0-9_]{4,}|(?:https?:\/\/)?wa\.me\/\S+|mailto:\S+|tel:\+?\d+|(?:телефон|контакт|email|почта)\s*[:—-]\s*\S+/i.test(
    String(text || '')
  );
}

async function buildAutomationSettingsAudit() {
  const current = await storageGet([
    'agentDebugLogsEnabled',
    'agentDebugRetentionCount',
    'aiEnabled',
    'aiFallbackProvider',
    'aiFallbackEnabled',
    'aiFallbackToGroq',
    'aiProvider',
    'aiProviderCredentials',
    'dailyLimit',
    'employmentPreference',
    'expectedSalary',
    'groqApiKey',
    'resumeParsedAt',
    'resumeParsedText',
    'resumeParsedUrl',
    'resumeProfileAutoRefreshEnabled',
    'resumeProfileCheckedAt',
    'resumeProfileText',
    'resumeUrl',
    'telegramUsername',
    'workFormatPreference'
  ]);
  const aiEnabled = current.aiEnabled !== false;
  const resumeUrl = normalizeResumeUrl(current.resumeUrl);
  const resumeText = String(current.resumeParsedText || '');
  const resumeSalary = extractResumeSalaryAmount(resumeText);
  const configuredSalary = normalizeComparableMoney(current.expectedSalary);
  const employmentPreference = normalizeMultiPreference(
    current.employmentPreference,
    EMPLOYMENT_PREFERENCE_VALUES
  );
  const workFormatPreference = normalizeMultiPreference(
    current.workFormatPreference,
    WORK_FORMAT_PREFERENCE_VALUES
  );
  const requiredWorkFormats = [
    /удален|remote/i.test(resumeText) ? 'remote' : '',
    /гибрид|hybrid/i.test(resumeText) ? 'hybrid' : ''
  ].filter(Boolean);
  const selectedProvider = AI_PROVIDERS.normalizeProviderId(current.aiProvider);
  const selectedProviderKey = AI_PROVIDERS.getApiKey(current, selectedProvider);
  const fallbackProvider = AI_PROVIDERS.normalizeFallbackProvider(current, selectedProvider);
  const checks = {
    resumeUrlConfigured: Boolean(resumeUrl),
    resumeUrlCurrent: Boolean(resumeUrl && normalizeResumeUrl(current.resumeParsedUrl) === resumeUrl),
    resumeProfileAvailable: !aiEnabled || Boolean(String(current.resumeProfileText || '').trim()),
    resumeProfileFresh: !aiEnabled || Boolean(
      current.resumeProfileCheckedAt &&
      Date.now() - Date.parse(current.resumeProfileCheckedAt) <= 24 * 60 * 60 * 1000
    ),
    expectedSalaryConfigured: configuredSalary ? true : null,
    expectedSalaryMatchesResume: resumeSalary ? configuredSalary === resumeSalary : null,
    contactConfigured: Boolean(
      String(current.telegramUsername || '').trim() ||
      hasConfiguredResumeContact(resumeText)
    ),
    laborContractEnabled: employmentPreference.includes('labor_contract'),
    workFormatsMatchResume: requiredWorkFormats.every((value) => workFormatPreference.includes(value)),
    dailyLimit200: Number.isFinite(Number(current.dailyLimit)) &&
      Number(current.dailyLimit) >= 1 && Number(current.dailyLimit) <= 200,
    debugLogsEnabled: current.agentDebugLogsEnabled === true,
    debugRetention20: Number(current.agentDebugRetentionCount) >= 20,
    resumeAutoRefreshEnabled: !aiEnabled || current.resumeProfileAutoRefreshEnabled === true,
    aiProviderKeyConfigured: !aiEnabled || AI_PROVIDERS.getProvider(selectedProvider).local || Boolean(selectedProviderKey),
    fallbackProviderReady: !aiEnabled || !fallbackProvider || Boolean(AI_PROVIDERS.getApiKey(current, fallbackProvider))
  };
  const issues = Object.entries(checks)
    .filter(([, passed]) => passed === false)
    .map(([name]) => name);
  const audit = {
    checkedAt: nowIso(),
    aiEnabled,
    checks,
    issues,
    ready: issues.length === 0
  };
  await storageSet({ automationSettingsAudit: audit });
  await appendAgentLog('automation_settings_audit', audit);
  return audit;
}

function getAiTaskLabel(task) {
  if (task === 'test_assist') return 'ответы на вопросы работодателя';
  if (task === 'resume_profile_build' || task === 'resume_profile_edit') return 'профиль резюме';
  return 'сопроводительное письмо';
}

function normalizeUsage(usage = {}) {
  usage = usage && typeof usage === 'object' ? usage : {};
  const nativeUsage = usage?.prompt_eval_count !== undefined || usage?.eval_count !== undefined;
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens;
  return {
    promptTokens: Number.isFinite(Number(nativeUsage ? usage.prompt_eval_count : usage.prompt_tokens)) ? Number(nativeUsage ? usage.prompt_eval_count : usage.prompt_tokens) : null,
    completionTokens: Number.isFinite(Number(nativeUsage ? usage.eval_count : usage.completion_tokens)) ? Number(nativeUsage ? usage.eval_count : usage.completion_tokens) : null,
    totalTokens: Number.isFinite(Number(nativeUsage ? Number(usage.prompt_eval_count || 0) + Number(usage.eval_count || 0) : usage.total_tokens)) ? Number(nativeUsage ? Number(usage.prompt_eval_count || 0) + Number(usage.eval_count || 0) : usage.total_tokens) : null,
    cachedTokens: Number.isFinite(Number(cachedTokens)) ? Number(cachedTokens) : 0,
    reasoningTokens: Number.isFinite(Number(usage?.completion_tokens_details?.reasoning_tokens))
      ? Number(usage.completion_tokens_details.reasoning_tokens)
      : Number.isFinite(Number(usage?.reasoning_tokens))
        ? Number(usage.reasoning_tokens)
        : 0
  };
}

function summarizeAiResponse(data = {}) {
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
    throw aiProviderError('AI-провайдер вернул некорректный JSON ответов работодателю', 'HHJA_AI_PROVIDER_INVALID_OUTPUT', true);
  }
  if (!parsed || !Array.isArray(parsed.answers) || typeof parsed.coverLetter !== 'string') {
    throw aiProviderError('AI-провайдер вернул неполный структурированный ответ работодателю', 'HHJA_AI_PROVIDER_INVALID_OUTPUT', true);
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
      throw aiProviderError('AI-провайдер вернул дублирующиеся или некорректные идентификаторы ответов', 'HHJA_AI_PROVIDER_INVALID_OUTPUT', true);
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

function validateEmployerAnswers(structured, questions, coverLetterRequested, allowStructuredCoverLetter = false) {
  const invalid = () => { throw aiProviderError('AI-провайдер вернул непригодные ответы работодателю', 'HHJA_AI_PROVIDER_INVALID_OUTPUT', true); };
  if (structured.answers.length !== questions.length) invalid();
  for (const question of questions) {
    const answer = structured.answers.find(item => item.id === question.id);
    if (!answer) invalid();
    const options = (question.options || []).map(option => cleanPlainText(typeof option === 'string' ? option : option.label));
    if (options.length) {
      if (!answer.selectedOptions.length || new Set(answer.selectedOptions).size !== answer.selectedOptions.length) invalid();
      if (answer.selectedOptions.some(option => !options.includes(option) || /^(on|true|short)$/i.test(option))) invalid();
      if (question.inputType !== 'checkbox' && answer.selectedOptions.length !== 1) invalid();
    } else {
      if (!answer.answer || answer.selectedOptions.length) invalid();
      const shortNumber = /^\d+$/.test(answer.answer) && /сколько|количеств|число|лет|год|разработчик|команд|зарплат|доход/i.test(question.question);
      if (!shortNumber && globalThis.HHJobAssistantText.getGeneratedTextInvalidReason(answer.answer, { minLength: 2 })) invalid();
      const salary = /зарплат|заработн|доход|компенсац|оклад|gross|salary|income/i.test(question.question);
      if (salary && !/\d/.test(answer.answer)) {
        if (/сумм|размер|сколько|оклад|рубл|тенге|amount|annual|monthly|net|gross/i.test(question.question) || !/по\s+договор[её]нности/i.test(answer.answer)) invalid();
      }
      const contact = /как\s+с\s+вами\s+связаться|контакт(?:ы|ные)?\s+для\s+связи|contact\s+(?:details|info)/i.test(question.question) || (/telegram|телеграм|мессендж|whatsapp/i.test(question.question) && /ник|аккаунт|ссылк|контакт|номер|телефон|username/i.test(question.question) && /укажите|напишите|оставьте|дайте/i.test(question.question));
      if (contact && !/(?:^|\s)(?:@[a-z0-9_]{4,}|t\.me\/[a-z0-9_]+|https?:\/\/\S+|телеграм|telegram|whatsapp|wa\.me\/\S+)|общение\s+через\s+hh\.ru/i.test(answer.answer)) invalid();
      const comparable = value => cleanPlainText(value).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const value = comparable(answer.answer);
      const prompt = comparable(question.question);
      if (value && prompt && (value === prompt || (value.length > 20 && prompt.includes(value)))) invalid();
      if (/(?:резюме кандидата|текст вакансии|choice group|text question|ответы на вопросы работодателя)/i.test(answer.answer)) invalid();
      if (question.inputType === 'number' && !/^[-+]?\d+(?:[.,]\d+)?$/.test(answer.answer)) invalid();
    }
  }
  if (coverLetterRequested) {
    if (allowStructuredCoverLetter) {
      const lines = structured.coverLetter.split(/\n+/).map(cleanPlainText).filter(Boolean);
      if (!lines.length || structured.coverLetter.length > 2200) invalid();
      lines.forEach((line, index) => {
        const match = line.match(/^(\d+)[.)]\s+(.+)$/);
        if (!match || Number(match[1]) !== index + 1 || globalThis.HHJobAssistantText.getGeneratedTextInvalidReason(match[2], { minLength: 1 })) invalid();
      });
    } else if (validateProviderCoverLetter(structured.coverLetter)) invalid();
  }
}

function formatAiEmptyResponseError({ providerLabel, task, status, finishReason, attempt, maxAttempts, maxTokens, usage }) {
  const normalizedUsage = normalizeUsage(usage);
  const parts = [
    `задача: ${getAiTaskLabel(task)}`,
    `HTTP ${status || 200}`,
    finishReason ? `finish_reason=${finishReason}` : '',
    `попытки ${attempt}/${maxAttempts}`,
    `max_tokens=${maxTokens}`
  ];
  if (normalizedUsage.completionTokens != null) {
    parts.push(`completion_tokens=${normalizedUsage.completionTokens}`);
  }
  return `${providerLabel} вернул пустой ответ (${parts.filter(Boolean).join(', ')}). Если finish_reason=length, модель уперлась в лимит вывода и не вернула message.content.`;
}

function getProviderCooldown(settings, providerId) {
  const cooldowns = settings.aiProviderCooldowns && typeof settings.aiProviderCooldowns === 'object'
    ? settings.aiProviderCooldowns
    : {};
  return String(cooldowns[providerId] || (providerId === 'groq' ? settings.groqCooldownUntil : '') || '');
}

async function setProviderCooldown(providerId, cooldownUntil) {
  const { aiProviderCooldowns = {} } = await storageGet(['aiProviderCooldowns']);
  const patch = {
    aiProviderCooldowns: {
      ...(aiProviderCooldowns && typeof aiProviderCooldowns === 'object' ? aiProviderCooldowns : {}),
      [providerId]: cooldownUntil
    }
  };
  if (providerId === 'groq') patch.groqCooldownUntil = cooldownUntil;
  await storageSet(patch);
}

function buildProviderRequestBody({ providerId, task, messages, attempt = 1, ollamaModel = '' }) {
  const provider = AI_PROVIDERS.getProvider(providerId);
  const capability = AI_PROVIDERS.getTaskCapability(provider.id, task);
  const requestBody = {
    model: provider.local ? String(ollamaModel || capability.model).trim() : capability.model,
    messages,
    temperature: task.startsWith('resume_profile_') ? 0 : 0.2,
    max_tokens: AI_PROVIDERS.getTaskMaxTokens(provider.id, task, attempt),
    ...provider.requestExtras,
    ...capability.requestExtras
  };
  if (provider.local) {
    requestBody.options = { temperature: requestBody.temperature, num_predict: requestBody.max_tokens };
    delete requestBody.temperature;
    delete requestBody.max_tokens;
    if (capability.responseFormat) requestBody.format = capability.responseFormat.json_schema?.schema || capability.responseFormat;
  } else if (capability.responseFormat) requestBody.response_format = capability.responseFormat;
  if (provider.id === 'groq' && task === 'test_assist') {
    const inputTokens = estimateGroqRequestTokens({ ...requestBody, max_tokens: 0 }).likelyRateTokens;
    const tpmLimit = GROQ_PUBLISHED_TPM_LIMITS[requestBody.model];
    // Keep the larger output allowance within the existing request quota.
    // Requests that cannot fit even the previous allowance still fail preflight.
    if (tpmLimit) requestBody.max_tokens = Math.min(requestBody.max_tokens, Math.max(700, tpmLimit - inputTokens));
  }
  return requestBody;
}

function validateProviderCoverLetter(content) {
  return globalThis.HHJA_AI_VALIDATION.coverLetterInvalidReason(String(content || ''));
}

async function executeAiProviderRequest(input) {
  try {
    return await executeAiProviderRequestInner(input);
  } catch (error) {
    error.provider = input.providerId;
    error.task = input.task;
    if (error.code === 'HHJA_AI_PROVIDER_INVALID_OUTPUT') error.httpStatus ??= 200;
    await appendAgentLog('ai_operation_error', { provider: error.provider, task: error.task, errorCode: error.code, httpStatus: error.httpStatus, providerErrorCode: error.providerErrorCode });
    throw error;
  }
}

async function executeAiProviderRequestInner({ providerId, apiKey, task, messages, logDetails = {}, attempt = 1, maxAttempts = 1, questions = [], coverLetterRequested = false, allowStructuredCoverLetter = false, ollamaModel: requestedOllamaModel = '', deadlineAt = AI_PROVIDERS.createOperationDeadline({ aiProvider: providerId }, task) }) {
  assertAiDeadline(deadlineAt);
  const provider = AI_PROVIDERS.getProvider(providerId);
  const current = await storageGet(['aiProviderCooldowns', 'groqCooldownUntil']);
  const cooldownUntil = getProviderCooldown(current, provider.id);
  const cooldownUntilMs = Date.parse(cooldownUntil || 0);
  if (Number.isFinite(cooldownUntilMs) && cooldownUntilMs > Date.now()) {
    await appendAgentLog('ai_request_skipped', {
      provider: provider.id,
      task,
      reason: 'cooldown',
      cooldownUntil
    });
    throw aiProviderError(
      `${provider.label} временно ограничил запросы. Пауза до ${cooldownUntil}.`,
      'HHJA_AI_PROVIDER_COOLDOWN',
      true
    );
  }

  const { ollamaModel = DEFAULTS.ollamaModel } = provider.local ? await storageGet(['ollamaModel']) : {};
  const requestBody = buildProviderRequestBody({ providerId: provider.id, task, messages, attempt, ollamaModel: requestedOllamaModel || ollamaModel });
  const startDetails = {
    provider: provider.id,
    task,
    model: requestBody.model,
    attempt,
    ...logDetails
  };
  await appendAgentLog('ai_request_start', startDetails);
  if (provider.id === 'groq') await appendAgentLog('groq_request_start', startDetails);
  const payloadDetails = {
    provider: provider.id,
    task,
    endpoint: provider.endpoint,
    method: 'POST',
    model: requestBody.model,
    enableThinking: requestBody.enable_thinking === true,
    responseFormat: requestBody.response_format?.type || '',
    messageCount: requestBody.messages.length,
    messageLengths: requestBody.messages.map((message) => ({
      role: message.role,
      contentLength: String(message.content || '').length
    })),
    temperature: requestBody.temperature,
    maxTokens: requestBody.max_tokens,
    attempt,
    ...logDetails
  };
  await appendAgentLog('ai_request_payload', payloadDetails);
  if (provider.id === 'groq') {
    await appendAgentLog('groq_request_payload', payloadDetails);
    if (task === 'test_assist') {
      await appendAgentLog('groq_test_assist_request', {
        task,
        endpoint: provider.endpoint,
        method: 'POST',
        requestBody
      });
    }
  }

  const { response, responseText, data } = await fetchProviderCompletion({
    providerId: provider.id,
    task,
    model: requestBody.model,
    apiKey,
    requestBody,
    deadlineAt
  });
  if (!response.ok) {
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after')) || GROQ_RATE_LIMIT_FALLBACK_COOLDOWN_MS;
      const nextCooldown = new Date(Date.now() + retryAfterMs).toISOString();
      await setProviderCooldown(provider.id, nextCooldown);
      await appendAgentLog('ai_rate_limit_cooldown', {
        provider: provider.id,
        task,
        cooldownUntil: nextCooldown,
        retryAfterMs
      });
      if (provider.id === 'groq') {
        await appendAgentLog('groq_rate_limit_cooldown', {
          task,
          cooldownUntil: nextCooldown,
          retryAfterMs
        });
      }
    }
    const errorDetails = {
      provider: provider.id,
      task,
      status: response.status,
      responseTextLength: responseText.length,
      responseTextHash: hashText(responseText),
      attempt,
      maxAttempts
    };
    await appendAgentLog('ai_request_error', errorDetails);
    if (provider.id === 'groq') await appendAgentLog('groq_request_error', errorDetails);
    if (task === 'resume_profile_build' || task === 'resume_profile_edit') {
      await appendAgentLog('resume_profile_request_error', {
        ...errorDetails,
        usage: { reasoningTokens: normalizeUsage(data?.usage).reasoningTokens }
      });
    }
    const providerErrorCode = String(data?.code || data?.error?.code || '');
    const providerHttpMessage = provider.id === 'qwen' && providerErrorCode === 'AccessDenied.Unpurchased'
      ? 'Qwen недоступен: сервис Alibaba Cloud Model Studio не активирован для этого аккаунта. Активируйте Model Studio или выберите Groq.'
      : `Запрос ${provider.label} завершился ошибкой: HTTP ${response.status}`;
    const error = aiProviderError(providerHttpMessage, 'HHJA_AI_PROVIDER_HTTP', true);
    error.httpStatus = response.status;
    if (/^[A-Za-z0-9_.:-]{1,100}$/.test(providerErrorCode)) error.providerErrorCode = providerErrorCode;
    throw error;
  }

  const rawContent = provider.local ? data?.message?.content : data?.choices?.[0]?.message?.content;
  const content = typeof rawContent === 'string' ? rawContent.trim() : '';
  const finishReason = provider.local ? (data?.done_reason || (data?.done === true ? 'stop' : '')) : data?.choices?.[0]?.finish_reason || '';
  if (!content || finishReason === 'length') {
    const errorDetails = {
      provider: provider.id,
      task,
      status: response.status,
      error: content ? 'truncated_response' : 'empty_response',
      attempt,
      maxAttempts,
      finishReason,
      maxTokens: requestBody.max_tokens,
      responseSummary: summarizeAiResponse(data)
    };
    await appendAgentLog('ai_request_error', errorDetails);
    if (provider.id === 'groq') await appendAgentLog('groq_request_error', errorDetails);
    if (task === 'resume_profile_build' || task === 'resume_profile_edit') {
      await appendAgentLog('resume_profile_request_error', {
        ...errorDetails,
        usage: { reasoningTokens: normalizeUsage(data?.usage).reasoningTokens }
      });
    }
    throw aiProviderError(
      formatAiEmptyResponseError({
        providerLabel: provider.label,
        task,
        status: response.status,
        finishReason,
        attempt,
        maxAttempts,
        maxTokens: requestBody.max_tokens,
        usage: data?.usage
      }),
      'HHJA_AI_PROVIDER_INVALID_OUTPUT',
      true
    );
  }

  const usage = normalizeUsage(provider.local ? data : data?.usage);
  const responseDetails = {
    provider: provider.id,
    task,
    responseLength: content.length,
    responseHash: hashText(content),
    finishReason,
    choiceCount: provider.local ? (data?.message ? 1 : 0) : Array.isArray(data?.choices) ? data.choices.length : 0,
    model: data?.model || requestBody.model,
    usage,
    attempt
  };
  await appendAgentLog('ai_response_payload', responseDetails);
  if (provider.id === 'groq') await appendAgentLog('groq_response_payload', responseDetails);
  let structured = null;
  if (task === 'test_assist') {
    structured = parseEmployerAnswerResponse(content);
    validateEmployerAnswers(structured, questions, coverLetterRequested, allowStructuredCoverLetter);
  } else if (task === 'cover_letter') {
    const invalidReason = validateProviderCoverLetter(content);
    if (invalidReason) {
      throw aiProviderError(
        `${provider.label} вернул неподходящее сопроводительное письмо: ${invalidReason}`,
        'HHJA_AI_PROVIDER_INVALID_OUTPUT',
        true
      );
    }
  }
  if (task.startsWith('resume_profile_')) parseResumeProfileResponse(content);
  assertAiDeadline(deadlineAt);
  return { provider, requestBody, content, data, usage, finishReason, structured };
}

async function callAi({ task = 'cover_letter', vacancyText = '', extraText = '', questions = [], coverLetterRequested = false, allowStructuredCoverLetter = false }, options = {}) {
  const {
    aiEnabled = DEFAULTS.aiEnabled,
    aiProvider,
    aiProviderCredentials = {},
    aiFallbackProvider,
    aiFallbackEnabled,
    aiFallbackToGroq = false,
    groqApiKey,
    expectedSalary = '',
    employmentPreference = DEFAULTS.employmentPreference,
    workFormatPreference = DEFAULTS.workFormatPreference,
    telegramUsername = DEFAULTS.telegramUsername,
    coverPrompt = DEFAULTS.coverPrompt,
    employerQuestionPrompt = DEFAULTS.employerQuestionPrompt,
  } = await storageGet(['aiEnabled', 'aiProvider', 'aiProviderCredentials', 'aiFallbackProvider', 'aiFallbackEnabled', 'aiFallbackToGroq', 'groqApiKey', 'expectedSalary', 'telegramUsername', 'employmentPreference', 'workFormatPreference', 'coverPrompt', 'employerQuestionPrompt']);
  if (aiEnabled === false) {
    throw aiProviderError('ИИ выключен в настройках', 'HHJA_AI_DISABLED', false);
  }
  const settings = {
    aiProvider,
    aiProviderCredentials,
    aiFallbackProvider,
    aiFallbackEnabled,
    aiFallbackToGroq,
    groqApiKey
  };
  const primaryProviderId = AI_PROVIDERS.normalizeProviderId(options.providerId || aiProvider);
  const primaryProvider = AI_PROVIDERS.getProvider(primaryProviderId);
  const primaryApiKey = String(
    Object.prototype.hasOwnProperty.call(options, 'apiKey')
      ? options.apiKey
      : AI_PROVIDERS.getApiKey(settings, primaryProviderId)
  ).trim();
  if (!primaryProvider.local && !primaryApiKey) {
    throw aiProviderError(`Ключ ${primaryProvider.label} API не настроен`, 'HHJA_AI_PROVIDER_NOT_CONFIGURED', false);
  }

  const profileState = await storageGet([
    'resumeProfileText',
    'resumeProfileSourceHash',
    'resumeProfileBuiltAt'
  ]);
  const resumeSourceText = await getResumeContext();
  const { resumeCandidateFacts = null } = await storageGet(['resumeCandidateFacts']);
  const candidateFacts = normalizeResumeCandidateFacts(resumeCandidateFacts, hashText(resumeSourceText));
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
    employerQuestionPrompt: sanitizeEmployerQuestionPrompt(employerQuestionPrompt).slice(0, COVER_PROMPT_GROQ_MAX_CHARS),
    vacancyText: compactVacancyText(vacancyText),
    extraText: compactExtraText(extraText),
    questions: Array.isArray(questions) ? questions : [],
    coverLetterRequested: Boolean(coverLetterRequested)
  };
  const messages = buildGroqMessages({
    task,
    ...payloadParts
  });
  const logDetails = {
    vacancyTextLength: String(vacancyText).length,
    extraTextLength: String(extraText).length,
    questionCount: payloadParts.questions.length,
    coverLetterRequested: payloadParts.coverLetterRequested,
    resumeSourceLength: String(resumeSourceText).length,
    resumeBriefLength: payloadParts.resumeText.length,
    resumeBriefVersion: resumeContext.version,
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
  };

  const deadlineAt = Math.min(Number(options.deadlineAt) || Infinity, AI_PROVIDERS.createOperationDeadline(settings, task));
  assertAiDeadline(deadlineAt);
  let completion;
  let fallbackReason = '';
  try {
    completion = await executeAiProviderRequest({
      providerId: primaryProviderId,
      apiKey: primaryApiKey,
      task,
      messages,
      logDetails,
      questions: payloadParts.questions,
      coverLetterRequested,
      allowStructuredCoverLetter,
      deadlineAt
    });
  } catch (error) {
    const fallbackProviderId = AI_PROVIDERS.normalizeFallbackProvider(settings, primaryProviderId);
    const fallbackApiKey = fallbackProviderId
      ? AI_PROVIDERS.getApiKey(settings, fallbackProviderId)
      : '';
    const canFallback = options.disableFallback !== true &&
      Boolean(fallbackProviderId) &&
      (AI_PROVIDERS.getProvider(fallbackProviderId || 'qwen').local || Boolean(fallbackApiKey)) &&
      error?.aiFallbackEligible === true;
    if (!canFallback) throw error;
    fallbackReason = error.code || 'HHJA_AI_PROVIDER_ERROR';
    await appendAgentLog('ai_provider_fallback_start', {
      task,
      fromProvider: primaryProviderId,
      toProvider: fallbackProviderId,
      reason: fallbackReason
    });
    try {
      completion = await executeAiProviderRequest({
        providerId: fallbackProviderId,
        apiKey: fallbackApiKey,
        task,
        messages,
        logDetails,
        questions: payloadParts.questions,
        coverLetterRequested,
        allowStructuredCoverLetter,
        deadlineAt
      });
      await appendAgentLog('ai_provider_fallback_complete', {
        task,
        fromProvider: primaryProviderId,
        toProvider: fallbackProviderId,
        reason: fallbackReason
      });
    } catch (fallbackError) {
      await appendAgentLog('ai_provider_fallback_error', {
        task,
        fromProvider: primaryProviderId,
        toProvider: fallbackProviderId,
        reason: fallbackReason,
        errorCode: fallbackError?.code || 'HHJA_UNKNOWN_ERROR'
      });
      throw fallbackError;
    }
  }

  const { content, data, usage, finishReason, provider } = completion;
  if (task === 'test_assist') {
    const structured = completion.structured;
    await appendAgentLog('ai_test_assist_response', {
      provider: provider.id,
      task,
      answerCount: structured.answers.length,
      coverLetterLength: structured.coverLetter.length,
      finishReason,
      model: data?.model || completion.requestBody.model,
      usage,
      attempt: 1
    });
    if (provider.id === 'groq') {
      await appendAgentLog('groq_test_assist_response', {
        task,
        answerCount: structured.answers.length,
        coverLetterLength: structured.coverLetter.length,
        finishReason,
        model: data?.model || completion.requestBody.model,
        usage,
        attempt: 1
      });
    }
    await appendAgentLog('ai_request_complete', { provider: provider.id, task, responseLength: content.length, usage, attempt: 1 });
    if (provider.id === 'groq') {
      await appendAgentLog('groq_request_complete', { task, responseLength: content.length, usage, attempt: 1 });
    }
    return { text: content, ...structured, provider: provider.id, usage, fallbackReason };
  }
  await appendAgentLog('ai_request_complete', { provider: provider.id, task, responseLength: content.length, usage, attempt: 1 });
  if (provider.id === 'groq') {
    await appendAgentLog('groq_request_complete', { task, responseLength: content.length, usage, attempt: 1 });
  }
  return { text: content, answers: [], coverLetter: content, provider: provider.id, usage, fallbackReason };
}

async function testAiProvider(providerId, apiKey, hasApiKeyOverride = false, ollamaModel = '') {
  await assertAiEnabled();
  const config = await storageGet(['aiProvider', 'aiProviderCredentials', 'groqApiKey']);
  const id = AI_PROVIDERS.normalizeProviderId(providerId || config.aiProvider);
  const key = String(hasApiKeyOverride ? apiKey || '' : AI_PROVIDERS.getApiKey(config, id)).trim();
  if (!AI_PROVIDERS.getProvider(id).local && !key) throw aiProviderError(`Ключ ${AI_PROVIDERS.getProvider(id).label} API не настроен`, 'HHJA_AI_PROVIDER_NOT_CONFIGURED');
  const checks = [];
  const deadlineAt = Date.now() + AI_PROVIDERS.getProvider(id).timeoutMs;
  const questions = [{ id: 'experience', kind: 'text', inputType: 'text', question: 'Сколько лет опыта Java?', options: [] }];
  for (const task of ['cover_letter', 'resume_profile_build', 'test_assist']) {
    const instruction = task === 'cover_letter'
      ? DEFAULTS.coverPrompt
      : task === 'resume_profile_build'
        ? 'Верни JSON {"profile":"профиль кандидата не короче 40 символов","weaknesses":[]}. Используй только факты.'
        : 'Верни JSON {"answers":[{"id":"experience","answer":"3 года","selectedOptions":[]}],"coverLetter":""}.';
    try {
      const result = await executeAiProviderRequest({ providerId: id, apiKey: key, ollamaModel, deadlineAt, task, questions: task === 'test_assist' ? questions : [], messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: 'Синтетический кандидат: Java разработчик, 3 года опыта Spring Boot и SQL. Вакансия Java разработчика.' }
      ] });
      checks.push({ task, model: result.requestBody.model, ok: true, sampleLength: result.content.length });
    } catch (error) {
      checks.push({ task, model: AI_PROVIDERS.getTaskCapability(id, task).model, ok: false, error: localizeError(error), errorCode: error.code, httpStatus: error.httpStatus });
    }
  }
  const failure = checks.find(check => !check.ok);
  return failure
    ? { ok: false, provider: id, checks, error: failure.error, errorCode: failure.errorCode, task: failure.task, httpStatus: failure.httpStatus }
    : { ok: true, provider: id, checks, sampleLength: checks[0].sampleLength };
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

function isAutoApplySearchUrl(value) {
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

function isSafeHhStatusUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' &&
      (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru')) &&
      !/\/account\/(?:login|signup)/.test(url.pathname);
  } catch {
    return false;
  }
}

function isHhApplicantProfileUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' &&
      (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru')) &&
      /^\/applicant\/profile\/me\/?$/.test(url.pathname);
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
    return url.searchParams.get('vacancyId') || url.pathname.match(/^\/vacancy\/(\d+)/)?.[1] || '';
  } catch {
    return '';
  }
}

function isHhVacancyDetailUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' &&
      (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru')) &&
      /^\/vacancy\/\d+/.test(url.pathname);
  } catch {
    return false;
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

async function recoverStalledResponseNavigation(watchdog) {
  let recovery = null;
  await enqueueAutoApplyOwnership(async () => {
    const stored = await storageGet([
      AUTO_APPLY_RUN_LEASE_KEY,
      AUTO_APPLY_RESPONSE_ATTEMPTS_KEY,
      'autoApplyQueue',
      'autoApplySearchQueue',
      'runState',
      'runResults'
    ]);
    const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
    const tabId = normalizeRunOwnerId(watchdog?.tabId);
    const runId = normalizeRunId(watchdog?.runId);
    const vacancyId = String(watchdog?.vacancyId || '');
    if (
      lease?.active !== true ||
      normalizeRunId(lease.runId) !== runId ||
      normalizeRunOwnerId(lease.ownerId) !== tabId ||
      normalizeRunOwnerId(watchdog?.ownerId) !== tabId
    ) return;
    const queue = stored.autoApplyQueue;
    const searchQueue = stored.autoApplySearchQueue;
    const item = queue?.items?.[queue.index || 0] || {};
    const attemptKey = responseAttemptStorageKey(runId, vacancyId, tabId);
    const attempt = stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY]?.[attemptKey];
    if (
      !queue?.active || normalizeRunId(queue.runId) !== runId ||
      String(item.vacancyId || '') !== vacancyId ||
      !attempt || attempt.finalizedAt || attempt.cancelledAt ||
      String(attempt.responseUrl || '') !== String(watchdog.url || '') ||
      !isAutoApplySearchUrl(queue.sourceUrl)
    ) return;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.id || tab.url !== watchdog.url || !isHhResponseFormUrl(tab.url)) return;
    const runState = stored.runState || DEFAULTS.runState;
    if (normalizeRunId(runState.runId) !== runId || isResponseFormProcessingState(runState)) return;
    const stateUpdatedAt = Date.parse(runState.updatedAt || '');
    if (Number.isFinite(stateUpdatedAt) && stateUpdatedAt > Number(watchdog.scheduledAt || 0)) return;
    const counters = {
      found: 0, processed: 0, applied: 0, alreadyApplied: 0, skipped: 0, errors: 0,
      ...(queue.counters || searchQueue?.counters || {})
    };
    counters.processed = Math.max(Number(counters.processed) || 0, Number(runState.processed) || 0);
    counters.skipped = Math.max(Number(counters.skipped) || 0, Number(runState.skipped) || 0) + 1;
    const error = 'Пропущено: страница отклика HH не загрузилась вовремя.';
    const result = {
      index: item.index || Number(queue.index || 0) + 1,
      vacancyId,
      title: item.title || '',
      url: item.url || watchdog.url,
      status: 'skipped_response_page_timeout',
      coverLetterUsed: false,
      testDetected: Boolean(item.testDetected),
      error,
      timestamp: nowIso()
    };
    const attempts = { ...(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY] || {}) };
    attempts[attemptKey] = { ...attempt, cancelledAt: result.timestamp, cancelReason: 'response_page_timeout' };
    const processedVacancyIds = [...new Set([
      ...(queue.processedVacancyIds || []),
      ...(searchQueue?.processedVacancyIds || []),
      vacancyId
    ].filter(Boolean))];
    const nextSearchQueue = {
      active: true,
      runId,
      ownerId: tabId,
      limit: queue.limit || searchQueue?.limit || 20,
      counters,
      config: queue.config || searchQueue?.config,
      processedVacancyIds
    };
    await storageSet({
      [AUTO_APPLY_RESPONSE_ATTEMPTS_KEY]: attempts,
      runResults: [...(stored.runResults || []).slice(-(AUTO_APPLY_RUN_RESULTS_LIMIT - 1)), result],
      autoApplyQueue: { ...queue, active: false, responseAttempt: null, recoveredFromUrl: watchdog.url, counters },
      autoApplySearchQueue: nextSearchQueue,
      runState: {
        ...DEFAULTS.runState,
        ...runState,
        ...counters,
        state: 'applying',
        runId,
        ownerId: tabId,
        currentAction: 'Возвращаюсь на страницу поиска HH',
        lastError: error,
        updatedAt: result.timestamp
      }
    });
    recovery = { tabId, vacancyId, sourceUrl: queue.sourceUrl, responseUrl: watchdog.url };
  });
  if (!recovery) return;
  await appendAgentLog('response_navigation_watchdog_recovered', recovery);
  await chrome.tabs.update(recovery.tabId, { url: recovery.sourceUrl }).catch(() => {});
}

async function handleResponseNavigationWatchdogAlarm() {
  const { responseNavigationWatchdog = null } = await storageGet(['responseNavigationWatchdog']);
  if (!responseNavigationWatchdog?.tabId || !responseNavigationWatchdog?.url) return;
  const handledWatchdog = { ...responseNavigationWatchdog };
  try {
    await recoverStalledResponseNavigation(handledWatchdog);
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
    const scheduled = await enqueueAutoApplyOwnership(async () => {
      const stored = await storageGet([
        AUTO_APPLY_RUN_LEASE_KEY,
        AUTO_APPLY_RESPONSE_ATTEMPTS_KEY,
        'autoApplyQueue'
      ]);
      const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
      if (lease?.active !== true || normalizeRunOwnerId(lease.ownerId) !== normalizeRunOwnerId(tabId)) return null;
      const vacancyId = getVacancyIdFromUrl(url);
      const runId = normalizeRunId(lease.runId);
      const key = responseAttemptStorageKey(runId, vacancyId, tabId);
      const attempt = stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY]?.[key];
      const queue = stored.autoApplyQueue;
      if (
        !vacancyId || !attempt || attempt.finalizedAt || attempt.cancelledAt ||
        String(attempt.responseUrl || '') !== String(url) ||
        normalizeRunId(queue?.runId) !== runId ||
        String(queue?.items?.[queue.index || 0]?.vacancyId || '') !== vacancyId
      ) return null;
      const watchdog = { tabId, ownerId: tabId, runId, vacancyId, url, scheduledAt };
      await storageSet({ responseNavigationWatchdog: watchdog });
      return watchdog;
    });
    if (!scheduled) return;
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

function scheduledSettings(value = {}) {
  const rawLateWindowMinutes = Number(value.scheduledAutoApplyLateWindowMinutes);
  return {
    enabled: value.scheduledAutoApplyEnabled === true,
    timeMsk: parseClockTime(value.scheduledAutoApplyTimeMsk, DEFAULTS.scheduledAutoApplyTimeMsk).text,
    lateWindowMinutes: Math.max(0, Math.min(
      Number.isFinite(rawLateWindowMinutes) ? rawLateWindowMinutes : DEFAULTS.scheduledAutoApplyLateWindowMinutes,
      12 * 60
    )),
    filterUrl: normalizeScheduledFilterUrl(value.scheduledAutoApplyFilterUrl),
    maxRepairAttempts: Math.max(1, Math.min(
      Number(value.scheduledAutoApplyMaxRepairAttempts) || DEFAULTS.scheduledAutoApplyMaxRepairAttempts,
      10
    )),
    repairCutoffMsk: parseClockTime(
      value.scheduledAutoApplyRepairCutoffMsk,
      DEFAULTS.scheduledAutoApplyRepairCutoffMsk
    ).text
  };
}

function isPendingScheduledReview(session) {
  return Boolean(
    session &&
    session.reviewRequired === true &&
    !safeStatusTimestamp(session.reviewedAt)
  );
}

function newScheduledSession({ dateMsk, filterUrl }) {
  const timestamp = new Date(schedulerNowMs()).toISOString();
  return {
    sessionId: `scheduled:${dateMsk}:${crypto.randomUUID()}`,
    dateMsk,
    runId: '',
    ownerId: 0,
    filterUrl,
    extensionVersion: getSafeManifestVersion(),
    state: 'starting',
    startedAt: '',
    updatedAt: timestamp,
    finishedAt: '',
    repairAttempts: 0,
    repairFromVersion: '',
    stopReason: '',
    reviewRequired: false,
    reviewOutcome: '',
    reviewIssues: [],
    reviewedAt: ''
  };
}

async function recreateScheduledAutoApplyAlarm({ catchUp = false, reason = 'settings' } = {}) {
  if (!chrome.alarms?.create) return { scheduled: false, reason: 'alarms_unavailable' };
  const values = await storageGet(SCHEDULED_AUTO_APPLY_SETTING_KEYS);
  const settings = scheduledSettings(values);
  await chrome.alarms.clear?.(SCHEDULED_AUTO_APPLY_ALARM);
  if (!settings.enabled) {
    await appendAgentLog('scheduled_auto_apply_alarm_disabled', { reason });
    return { scheduled: false, reason: 'disabled' };
  }
  if (!settings.filterUrl) {
    await appendAgentLog('scheduled_auto_apply_alarm_blocked', { reason: 'invalid_filter_url' });
    return { scheduled: false, reason: 'invalid_filter_url' };
  }
  const nowMs = schedulerNowMs();
  const decision = getScheduleDecision(nowMs, settings);
  const missed = catchUp && nowMs > decision.lateUntil;
  if (missed) {
    await appendAgentLog('scheduled_auto_apply_missed', {
      reason: 'late_start_window',
      dateMsk: decision.dateMsk,
      lateUntil: new Date(decision.lateUntil).toISOString()
    });
  }
  const when = catchUp && decision.catchUp ? nowMs + 250 : decision.nextAt;
  chrome.alarms.create(SCHEDULED_AUTO_APPLY_ALARM, { when });
  await appendAgentLog('scheduled_auto_apply_alarm_created', {
    reason,
    catchUp: catchUp && decision.catchUp,
    when: new Date(when).toISOString(),
    dateMsk: decision.dateMsk
  });
  return { scheduled: true, when, catchUp: catchUp && decision.catchUp, missed };
}

async function queryHhTabs() {
  if (!chrome.tabs?.query) return [];
  return chrome.tabs.query({ url: ['https://hh.ru/*', 'https://*.hh.ru/*'] }).catch(() => []);
}

async function getSafeContentStatus(tabId) {
  try {
    const status = await chrome.tabs.sendMessage(tabId, { type: 'GET_CONTENT_STATUS' });
    return status?.ok === true && status.authenticated === true && status.unsafe !== true ? status : null;
  } catch {
    return null;
  }
}

async function selectAuthenticatedScheduledTab(filterUrl) {
  const tabs = await queryHhTabs();
  for (const tab of tabs) {
    if (
      !tab?.id ||
      !isSafeHhStatusUrl(tab.url) ||
      normalizeScheduledFilterUrl(tab.url) !== filterUrl
    ) continue;
    const status = await getSafeContentStatus(tab.id);
    if (status) return { tab, exact: true };
  }
  if (chrome.tabs?.create) {
    const created = await chrome.tabs.create({ url: filterUrl, active: false }).catch(() => null);
    if (created?.id) {
      try {
        await waitForTabReady(created.id);
        const status = await getSafeContentStatus(created.id);
        if (status) return { tab: { ...created, url: filterUrl }, exact: true, created: true };
      } catch {
        // The newly created tab is removed below when authentication cannot be proven.
      }
      if (chrome.tabs.remove) await chrome.tabs.remove(created.id).catch(() => {});
    }
  }
  return null;
}

function unresolvedResponseAttempts(value) {
  return Object.values(value || {}).filter((attempt) => !attempt?.finalizedAt && !attempt?.cancelledAt);
}

async function reserveScheduledAutoApplyStart() {
  return enqueueAutoApplyOwnership(async () => {
    const stored = await storageGet([
      ...SCHEDULED_AUTO_APPLY_SETTING_KEYS,
      SCHEDULED_AUTO_APPLY_SESSION_KEY,
      DAILY_APPLICATION_LEDGER_KEY,
      'automationSettingsAudit',
      AUTO_APPLY_RUN_LEASE_KEY,
      'autoApplyPendingSubmit',
      AUTO_APPLY_RESPONSE_ATTEMPTS_KEY,
      'autoApplyQueue',
      'autoApplySearchQueue',
      'runState',
      'runResults'
    ]);
    await reconcileMissingAutoApplyOwnerLocked(stored);
    const settings = scheduledSettings(stored);
    const nowMs = schedulerNowMs();
    const decision = getScheduleDecision(nowMs, settings);
    if (!settings.enabled) return { ok: false, reason: 'disabled' };
    if (!settings.filterUrl) return { ok: false, reason: 'invalid_filter_url' };
    if (!decision.catchUp) return { ok: false, reason: 'missed_start_window' };
    const previous = stored[SCHEDULED_AUTO_APPLY_SESSION_KEY];
    if (previous?.dateMsk === decision.dateMsk) return { ok: false, reason: 'already_attempted_today' };
    if (isPendingScheduledReview(previous)) return { ok: false, reason: 'previous_review_required' };
    const ledger = normalizeDailyApplicationLedgerForMutation(
      stored[DAILY_APPLICATION_LEDGER_KEY],
      new Date(nowMs)
    );
    if (ledger.hhDailyLimitReached || ledger.newSubmitted >= SCHEDULED_AUTO_APPLY_LIMIT) {
      return { ok: false, reason: 'daily_limit_reached' };
    }
    if (buildSafeAutomationAudit(stored.automationSettingsAudit).ready !== true) {
      return { ok: false, reason: 'audit_not_ready' };
    }
    if (stored[AUTO_APPLY_RUN_LEASE_KEY]?.active === true) {
      return { ok: false, reason: 'active_run' };
    }
    if (stored.autoApplyQueue?.active === true || stored.autoApplySearchQueue?.active === true) {
      return { ok: false, reason: 'active_saved_queue' };
    }
    if (stored.autoApplyPendingSubmit?.item) return { ok: false, reason: 'pending_submit' };
    if (unresolvedResponseAttempts(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY]).length > 0) {
      return { ok: false, reason: 'unresolved_response_attempt' };
    }
    const selected = await selectAuthenticatedScheduledTab(settings.filterUrl);
    if (!selected) return { ok: false, reason: 'authentication_required' };
    const session = newScheduledSession({ dateMsk: decision.dateMsk, filterUrl: settings.filterUrl });
    await storageSet({ [SCHEDULED_AUTO_APPLY_SESSION_KEY]: session });
    return {
      ok: true,
      session,
      settings,
      tab: selected.tab,
      exact: selected.exact,
      created: selected.created === true
    };
  });
}

async function updateScheduledSession(sessionId, updater) {
  return enqueueAutoApplyOwnership(async () => {
    const stored = await storageGet([SCHEDULED_AUTO_APPLY_SESSION_KEY]);
    const session = stored[SCHEDULED_AUTO_APPLY_SESSION_KEY];
    if (!session || session.sessionId !== sessionId) return null;
    const next = updater({ ...session });
    if (!next) return session;
    next.updatedAt = new Date(schedulerNowMs()).toISOString();
    await storageSet({ [SCHEDULED_AUTO_APPLY_SESSION_KEY]: next });
    return next;
  });
}

async function runScheduledAutoApply() {
  await ensureDefaults({ preserveAutomationState: true });
  const reservation = await reserveScheduledAutoApplyStart();
  if (!reservation.ok) {
    await appendAgentLog('scheduled_auto_apply_skipped', { reason: reservation.reason });
    return reservation;
  }
  const { session, tab, created } = reservation;
  try {
    const status = await waitForContentStatus(tab.id);
    if (status.authenticated !== true || status.unsafe === true) {
      throw new Error('authentication_required');
    }
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'START_SCHEDULED_AUTO_APPLY',
      sessionId: session.sessionId,
      dateMsk: session.dateMsk,
      limitOverride: SCHEDULED_AUTO_APPLY_LIMIT,
      delayMinMs: SCHEDULED_AUTO_APPLY_DELAY_MIN_MS,
      delayMaxMs: SCHEDULED_AUTO_APPLY_DELAY_MAX_MS
    });
    if (response?.ok !== true || response?.alreadyRunning === true) {
      throw new Error(response?.alreadyRunning ? 'parallel_run_conflict' : 'scheduled_start_rejected');
    }
    await appendAgentLog('scheduled_auto_apply_started', {
      sessionId: session.sessionId,
      dateMsk: session.dateMsk,
      tabId: tab.id
    });
    return { ok: true, sessionId: session.sessionId, runId: response.activeRunId || '' };
  } catch (error) {
    const recovery = await storageGet([
      SCHEDULED_AUTO_APPLY_SESSION_KEY,
      AUTO_APPLY_RUN_LEASE_KEY,
      'autoApplyQueue',
      'autoApplySearchQueue'
    ]);
    const recoveredSession = recovery[SCHEDULED_AUTO_APPLY_SESSION_KEY];
    const recoveredLease = recovery[AUTO_APPLY_RUN_LEASE_KEY];
    const recoveredRunId = normalizeRunId(recoveredLease?.runId);
    const recoveredOwnerId = normalizeRunOwnerId(recoveredLease?.ownerId);
    const matchingActiveQueue = [recovery.autoApplyQueue, recovery.autoApplySearchQueue].some((queue) => (
      queue?.active === true &&
      normalizeRunId(queue.runId) === recoveredRunId &&
      normalizeRunOwnerId(queue.ownerId) === recoveredOwnerId &&
      String(queue.scheduledSessionId || '') === String(session.sessionId || '')
    ));
    const claimedRunSurvived = recoveredSession?.sessionId === session.sessionId &&
      recoveredSession.state === 'running' &&
      recoveredLease?.active === true &&
      recoveredRunId &&
      recoveredOwnerId === normalizeRunOwnerId(tab?.id) &&
      matchingActiveQueue;
    if (claimedRunSurvived) {
      await appendAgentLog('scheduled_auto_apply_start_ack_lost', {
        sessionId: session.sessionId,
        dateMsk: session.dateMsk,
        tabId: tab.id,
        runId: recoveredRunId,
        error: localizeError(error)
      });
      return {
        ok: true,
        sessionId: session.sessionId,
        runId: recoveredRunId,
        startAcknowledgementLost: true
      };
    }
    const terminalSessionSurvived = recoveredSession?.sessionId === session.sessionId &&
      SCHEDULED_AUTO_APPLY_TERMINAL_STATES.has(recoveredSession.state) &&
      normalizeRunOwnerId(recoveredSession.ownerId) === normalizeRunOwnerId(tab?.id) &&
      normalizeRunId(recoveredSession.runId);
    if (terminalSessionSurvived) {
      const terminalRunId = normalizeRunId(recoveredSession.runId);
      await appendAgentLog('scheduled_auto_apply_start_ack_lost', {
        sessionId: session.sessionId,
        dateMsk: session.dateMsk,
        tabId: tab.id,
        runId: terminalRunId,
        terminalState: recoveredSession.state,
        error: localizeError(error)
      });
      if (recoveredSession.state === 'complete') {
        return {
          ok: true,
          sessionId: session.sessionId,
          runId: terminalRunId,
          startAcknowledgementLost: true,
          completedBeforeAcknowledgement: true
        };
      }
      return {
        ok: false,
        reason: recoveredSession.stopReason || recoveredSession.state,
        sessionId: session.sessionId,
        runId: terminalRunId,
        startAcknowledgementLost: true,
        terminalState: recoveredSession.state
      };
    }
    await updateScheduledSession(session.sessionId, (current) => ({
      ...current,
      state: 'error',
      stopReason: String(error?.message || error || 'scheduled_start_error').slice(0, 80),
      finishedAt: new Date(schedulerNowMs()).toISOString(),
      reviewRequired: true
    }));
    if (created && tab?.id && chrome.tabs.remove) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
    await appendAgentLog('scheduled_auto_apply_error', {
      sessionId: session.sessionId,
      error: localizeError(error)
    });
    return { ok: false, reason: String(error?.message || 'scheduled_start_error') };
  }
}

async function acknowledgeScheduledSessionReview(message, sender) {
  if (!isSafeHhStatusUrl(sender?.tab?.url) || message?.authenticated !== true) {
    return { ok: false, acknowledged: false, reason: 'authenticated_safe_status_required' };
  }
  return enqueueAutoApplyOwnership(async () => {
    const { [SCHEDULED_AUTO_APPLY_SESSION_KEY]: session } = await storageGet([
      SCHEDULED_AUTO_APPLY_SESSION_KEY
    ]);
    const sessionId = String(message?.sessionId || '');
    const outcome = String(message?.outcome || '');
    if (!session || session.sessionId !== sessionId) {
      return { ok: false, acknowledged: false, reason: 'session_mismatch' };
    }
    if (!SCHEDULED_AUTO_APPLY_TERMINAL_STATES.has(session.state)) {
      return { ok: false, acknowledged: false, reason: 'session_not_terminal' };
    }
    if (!['passed', 'blocked'].includes(outcome)) {
      return { ok: false, acknowledged: false, reason: 'invalid_outcome' };
    }
    if (safeStatusTimestamp(session.reviewedAt)) {
      return { ok: true, acknowledged: true, alreadyAcknowledged: true };
    }
    const issues = [...new Set((Array.isArray(message?.issues) ? message.issues : [])
      .map((issue) => String(issue || '').trim().slice(0, 80))
      .filter(Boolean))].slice(0, 20);
    const reviewedAt = new Date(schedulerNowMs()).toISOString();
    await storageSet({
      [SCHEDULED_AUTO_APPLY_SESSION_KEY]: {
        ...session,
        ...(outcome === 'blocked' ? { state: 'blocked' } : {}),
        reviewOutcome: outcome,
        reviewIssues: issues,
        reviewedAt,
        updatedAt: reviewedAt
      }
    });
    return { ok: true, acknowledged: true, alreadyAcknowledged: false };
  });
}

async function requestScheduledRepairPause(message, sender) {
  if (!isSafeHhStatusUrl(sender?.tab?.url) || message?.authenticated !== true) {
    return { ok: false, checkpointed: false, reason: 'authenticated_safe_status_required' };
  }
  const reservation = await enqueueAutoApplyOwnership(async () => {
    const stored = await storageGet([
      SCHEDULED_AUTO_APPLY_SESSION_KEY,
      AUTO_APPLY_RUN_LEASE_KEY
    ]);
    const session = stored[SCHEDULED_AUTO_APPLY_SESSION_KEY];
    const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
    if (session?.state !== 'running') return { ok: false, reason: 'scheduled_run_not_running' };
    if (
      lease?.active !== true ||
      normalizeRunId(lease.runId) !== normalizeRunId(session.runId) ||
      normalizeRunOwnerId(lease.ownerId) !== normalizeRunOwnerId(session.ownerId)
    ) return { ok: false, reason: 'scheduled_run_not_owned' };
    return { ok: true, ownerId: normalizeRunOwnerId(session.ownerId) };
  });
  if (!reservation.ok || !reservation.ownerId) {
    return { ok: false, checkpointed: false, reason: reservation.reason || 'owner_missing' };
  }
  try {
    const response = await chrome.tabs.sendMessage(reservation.ownerId, {
      type: 'PAUSE_SCHEDULED_AUTO_APPLY_FOR_REPAIR'
    });
    return response?.ok === true && response?.checkpointed === true
      ? { ok: true, checkpointed: true }
      : { ok: false, checkpointed: false, reason: response?.reason || 'repair_pause_rejected' };
  } catch {
    return { ok: false, checkpointed: false, reason: 'repair_pause_unreachable' };
  }
}

function scheduledQueueProof(stored, session) {
  return [stored.autoApplyQueue, stored.autoApplySearchQueue].find((queue) => (
    queue?.active === true &&
    String(queue.scheduledSessionId || '') === String(session?.sessionId || '') &&
    String(queue.scheduledDateMsk || '') === String(session?.dateMsk || '') &&
    normalizeRunId(queue.runId) === normalizeRunId(session?.runId) &&
    normalizeRunOwnerId(queue.ownerId) === normalizeRunOwnerId(session?.ownerId)
  ));
}

async function authorizeScheduledContinuation(message, sender) {
  return enqueueAutoApplyOwnership(async () => {
    const stored = await storageGet([
      SCHEDULED_AUTO_APPLY_SESSION_KEY,
      AUTO_APPLY_RUN_LEASE_KEY,
      'autoApplyQueue',
      'autoApplySearchQueue'
    ]);
    const session = stored[SCHEDULED_AUTO_APPLY_SESSION_KEY];
    const ownerId = normalizeRunOwnerId(sender?.tab?.id);
    const allowed = Boolean(
      session?.state === 'running' &&
      session.sessionId === String(message?.sessionId || '') &&
      session.dateMsk === String(message?.dateMsk || '') &&
      session.dateMsk === getMoscowDateParts(schedulerNowMs()).dateMsk &&
      normalizeRunId(session.runId) === normalizeRunId(message?.runId) &&
      normalizeRunOwnerId(session.ownerId) === ownerId &&
      stored[AUTO_APPLY_RUN_LEASE_KEY]?.active === true &&
      normalizeRunId(stored[AUTO_APPLY_RUN_LEASE_KEY].runId) === normalizeRunId(session.runId) &&
      normalizeRunOwnerId(stored[AUTO_APPLY_RUN_LEASE_KEY].ownerId) === ownerId &&
      scheduledQueueProof(stored, session)
    );
    return { ok: true, authorized: allowed };
  });
}

async function checkpointScheduledRepair(message, sender) {
  return enqueueAutoApplyOwnership(async () => {
    const stored = await storageGet([
      SCHEDULED_AUTO_APPLY_SESSION_KEY,
      AUTO_APPLY_RUN_LEASE_KEY,
      AUTO_APPLY_RESPONSE_ATTEMPTS_KEY,
      'autoApplyPendingSubmit',
      'autoApplyQueue',
      'autoApplySearchQueue',
      'runState',
      'runResults'
    ]);
    const session = stored[SCHEDULED_AUTO_APPLY_SESSION_KEY];
    const ownerId = normalizeRunOwnerId(sender?.tab?.id);
    const runId = normalizeRunId(message?.runId);
    if (
      session?.state !== 'running' ||
      session.sessionId !== String(message?.sessionId || '') ||
      normalizeRunId(session.runId) !== runId ||
      normalizeRunOwnerId(session.ownerId) !== ownerId ||
      stored[AUTO_APPLY_RUN_LEASE_KEY]?.active !== true ||
      normalizeRunId(stored[AUTO_APPLY_RUN_LEASE_KEY]?.runId) !== runId ||
      normalizeRunOwnerId(stored[AUTO_APPLY_RUN_LEASE_KEY]?.ownerId) !== ownerId
    ) return { ok: false, checkpointed: false, reason: 'scheduled_run_not_owned' };
    if (stored.autoApplyPendingSubmit?.item) {
      return { ok: false, checkpointed: false, reason: 'unresolved_submit' };
    }
    if (unresolvedResponseAttempts(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY]).length > 0) {
      return { ok: false, checkpointed: false, reason: 'unresolved_response_attempt' };
    }
    const proof = scheduledQueueProof(stored, session);
    const timestamp = new Date(schedulerNowMs()).toISOString();
    if (!proof) {
      await terminalizeScheduledRepairSession(stored, session, 'missing_checkpoint');
      return { ok: false, checkpointed: false, reason: 'missing_checkpoint' };
    }
    const runResults = Array.isArray(stored.runResults) ? stored.runResults : [];
    const safeCounters = Object.fromEntries(
      ['found', 'processed', 'applied', 'alreadyApplied', 'skipped', 'errors']
        .filter((key) => Object.hasOwn(message?.counters || {}, key))
        .map((key) => [key, safeStatusCount(message.counters[key])])
    );
    const nextRunState = {
      ...DEFAULTS.runState,
      ...(stored.runState || {}),
      ...safeCounters,
      state: 'paused',
      runId,
      ownerId,
      processed: processedCountForRetainedResults(
        runResults,
        stored.runState?.processed,
        safeCounters.processed
      ),
      currentAction: 'Приостановлено для исправления',
      lastError: '',
      updatedAt: timestamp
    };
    await storageSet({
      autoApplyStopRequested: true,
      autoApplyStopRequestedAt: timestamp,
      autoApplyStopReason: 'repair_pending',
      runState: nextRunState,
      [AUTO_APPLY_RUN_LEASE_KEY]: {
        ...stored[AUTO_APPLY_RUN_LEASE_KEY],
        updatedAt: timestamp,
        scheduledRepairPending: true
      },
      [SCHEDULED_AUTO_APPLY_SESSION_KEY]: {
        ...session,
        state: 'repair_pending',
        repairFromVersion: getSafeManifestVersion(),
        stopReason: 'repair_pending',
        updatedAt: timestamp
      }
    });
    return { ok: true, checkpointed: true };
  });
}

async function terminalizeScheduledRepairSession(stored, session, reason) {
  const timestamp = new Date(schedulerNowMs()).toISOString();
  const runId = normalizeRunId(session.runId);
  const ownerId = normalizeRunOwnerId(session.ownerId);
  const matchesOwnedRun = (value) => (
    normalizeRunId(value?.runId) === runId &&
    normalizeRunOwnerId(value?.ownerId) === ownerId
  );
  const deactivateOwnedQueue = (queue) => (
    queue && matchesOwnedRun(queue)
      ? { ...queue, active: false, terminalReason: reason, updatedAt: timestamp }
      : (queue || { active: false })
  );
  const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
  const runResults = Array.isArray(stored.runResults) ? stored.runResults : [];
  const ownsRunState = !stored.runState?.runId || matchesOwnedRun(stored.runState);
  await storageSet({
    autoApplyStopRequested: true,
    autoApplyStopRequestedAt: timestamp,
    autoApplyStopReason: reason,
    autoApplyQueue: deactivateOwnedQueue(stored.autoApplyQueue),
    autoApplySearchQueue: deactivateOwnedQueue(stored.autoApplySearchQueue),
    ...(matchesOwnedRun(lease) ? {
      [AUTO_APPLY_RUN_LEASE_KEY]: {
        ...lease,
        active: false,
        scheduledRepairPending: false,
        updatedAt: timestamp,
        releasedState: 'blocked',
        releaseReason: reason
      }
    } : {}),
    ...(ownsRunState ? {
      runState: {
        ...DEFAULTS.runState,
        ...(stored.runState || {}),
        state: 'stopped',
        runId,
        ownerId,
        processed: processedCountForRetainedResults(runResults, stored.runState?.processed),
        currentAction: 'Scheduled-сессия заблокирована',
        lastError: reason,
        updatedAt: timestamp
      }
    } : {}),
    [SCHEDULED_AUTO_APPLY_SESSION_KEY]: {
      ...session,
      state: 'blocked',
      stopReason: reason,
      finishedAt: timestamp,
      updatedAt: timestamp,
      continuationAuthorizedAt: '',
      continuationAuthorizedVersion: '',
      reviewRequired: true
    }
  });
  return { ok: false, reason };
}

async function reserveScheduledRepairResume({ preReloadOnly = false } = {}) {
  return enqueueAutoApplyOwnership(async () => {
    const stored = await storageGet([
      ...SCHEDULED_AUTO_APPLY_SETTING_KEYS,
      SCHEDULED_AUTO_APPLY_SESSION_KEY,
      AUTO_APPLY_RUN_LEASE_KEY,
      AUTO_APPLY_RESPONSE_ATTEMPTS_KEY,
      'autoApplyPendingSubmit',
      'autoApplyQueue',
      'autoApplySearchQueue',
      'automationSettingsAudit',
      'runState',
      'runResults'
    ]);
    const session = stored[SCHEDULED_AUTO_APPLY_SESSION_KEY];
    if (session?.state !== 'repair_pending') return { ok: false, reason: 'no_repair_pending' };
    const settings = scheduledSettings(stored);
    const decision = getScheduleDecision(schedulerNowMs(), settings);
    const version = getSafeManifestVersion();
    const permanentBlock = (reason) => terminalizeScheduledRepairSession(stored, session, reason);
    if (stored.autoApplyPendingSubmit?.item) return { ok: false, reason: 'unresolved_submit' };
    if (unresolvedResponseAttempts(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY]).length > 0) {
      return { ok: false, reason: 'unresolved_response_attempt' };
    }
    if (session.dateMsk !== decision.dateMsk) return permanentBlock('date_mismatch');
    if (!decision.beforeRepairCutoff) return permanentBlock('repair_cutoff');
    if ((Number(session.repairAttempts) || 0) >= settings.maxRepairAttempts) {
      return permanentBlock('max_repair_attempts');
    }
    if (compareVersions(version, session.repairFromVersion) <= 0) {
      return { ok: false, reason: 'version_not_advanced' };
    }
    if (buildSafeAutomationAudit(stored.automationSettingsAudit).ready !== true) {
      return { ok: false, reason: 'audit_not_ready' };
    }
    const proof = scheduledQueueProof(stored, session);
    const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
    if (
      !proof ||
      lease?.active !== true ||
      normalizeRunId(lease.runId) !== normalizeRunId(session.runId) ||
      normalizeRunOwnerId(lease.ownerId) !== normalizeRunOwnerId(session.ownerId)
    ) return permanentBlock('missing_checkpoint');
    const tab = await chrome.tabs.get(normalizeRunOwnerId(session.ownerId)).catch(() => null);
    if (!tab) return { ok: false, reason: 'owner_missing' };
    if (preReloadOnly) {
      return {
        ok: true,
        preReloadOnly: true,
        tabId: tab.id,
        sessionId: session.sessionId,
        dateMsk: session.dateMsk,
        runId: session.runId
      };
    }
    if (!await getSafeContentStatus(tab.id)) return { ok: false, reason: 'owner_missing' };
    const timestamp = new Date(schedulerNowMs()).toISOString();
    await storageSet({
      autoApplyStopRequested: false,
      autoApplyStopRequestedAt: '',
      autoApplyStopReason: '',
      [AUTO_APPLY_RUN_LEASE_KEY]: {
        ...lease,
        scheduledRepairPending: false,
        updatedAt: timestamp
      },
      [SCHEDULED_AUTO_APPLY_SESSION_KEY]: {
        ...session,
        state: 'running',
        extensionVersion: version,
        repairAttempts: (Number(session.repairAttempts) || 0) + 1,
        stopReason: '',
        updatedAt: timestamp,
        continuationAuthorizedAt: timestamp,
        continuationAuthorizedVersion: version
      }
    });
    return { ok: true, tabId: tab.id, sessionId: session.sessionId, dateMsk: session.dateMsk, runId: session.runId };
  });
}

async function rollbackScheduledRepairContinuation(reservation) {
  return enqueueAutoApplyOwnership(async () => {
    const stored = await storageGet([
      SCHEDULED_AUTO_APPLY_SESSION_KEY,
      AUTO_APPLY_RUN_LEASE_KEY,
      'autoApplyQueue',
      'autoApplySearchQueue',
      'runState',
      'runResults'
    ]);
    const session = stored[SCHEDULED_AUTO_APPLY_SESSION_KEY];
    const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
    if (
      session?.state !== 'running' ||
      session.sessionId !== reservation.sessionId ||
      session.dateMsk !== reservation.dateMsk ||
      normalizeRunId(session.runId) !== normalizeRunId(reservation.runId) ||
      normalizeRunOwnerId(session.ownerId) !== normalizeRunOwnerId(reservation.tabId) ||
      lease?.active !== true ||
      normalizeRunId(lease.runId) !== normalizeRunId(reservation.runId) ||
      normalizeRunOwnerId(lease.ownerId) !== normalizeRunOwnerId(reservation.tabId)
    ) return { rolledBack: false, reason: 'resume_state_changed' };
    const timestamp = new Date(schedulerNowMs()).toISOString();
    const checkpointProven = Boolean(scheduledQueueProof(stored, session));
    if (!checkpointProven) {
      await terminalizeScheduledRepairSession(stored, session, 'missing_checkpoint');
      return { rolledBack: true, checkpointProven: false, terminal: true };
    }
    await storageSet({
      autoApplyStopRequested: true,
      autoApplyStopRequestedAt: timestamp,
      autoApplyStopReason: 'repair_pending',
      [AUTO_APPLY_RUN_LEASE_KEY]: {
        ...lease,
        updatedAt: timestamp,
        scheduledRepairPending: true
      },
      [SCHEDULED_AUTO_APPLY_SESSION_KEY]: {
        ...session,
        state: 'repair_pending',
        stopReason: 'repair_pending',
        updatedAt: timestamp,
        continuationAuthorizedAt: '',
        continuationAuthorizedVersion: '',
        reviewRequired: true
      }
    });
    return { rolledBack: true, checkpointProven };
  });
}

async function resumeScheduledRepair() {
  const reservation = await reserveScheduledRepairResume();
  if (!reservation.ok) return reservation;
  try {
    const response = await chrome.tabs.sendMessage(reservation.tabId, {
      type: 'CONTINUE_SCHEDULED_AUTO_APPLY',
      sessionId: reservation.sessionId,
      dateMsk: reservation.dateMsk,
      runId: reservation.runId
    });
    if (response?.ok === true) return { ok: true, resumed: true };
    await rollbackScheduledRepairContinuation(reservation);
    return { ok: false, reason: 'continue_rejected' };
  } catch {
    await rollbackScheduledRepairContinuation(reservation);
    return { ok: false, reason: 'continue_unreachable' };
  }
}

async function resumeScheduledRepairAfterExtensionUpdate() {
  const preflight = await reserveScheduledRepairResume({ preReloadOnly: true });
  if (!preflight.ok) return preflight;
  const ownerId = normalizeRunOwnerId(preflight.tabId);
  if (chrome.tabs.reload) {
    try {
      await chrome.tabs.reload(ownerId);
      await waitForTabReady(ownerId);
      await waitForContentStatus(ownerId);
    } catch {
      return { ok: false, reason: 'owner_reload_failed' };
    }
  }
  return resumeScheduledRepair();
}

async function startAutoApplyFromActiveTab() {
  globalThis.HHJA_CONFIG_READINESS.assertReady(await storageGet([
    'aiEnabled',
    'aiProvider',
    'aiProviderCredentials',
    'groqApiKey',
    'resumeUrl',
    'coverPrompt',
    'employerQuestionPrompt'
  ]));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isAutoApplySearchUrl(tab.url)) {
    throw new Error('Перед запуском откликов откройте страницу поиска вакансий или форму отклика на hh.ru.');
  }
  await appendAgentLog('command_start_auto_apply', { tabId: tab.id, url: tab.url });
  return chrome.tabs.sendMessage(tab.id, { type: 'START_AUTO_APPLY' });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await recreateScheduledAutoApplyAlarm({ catchUp: false, reason: 'installed' });
  await resumeScheduledRepairAfterExtensionUpdate();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await reconcileMissingAutoApplyOwner();
  await restoreResponseNavigationWatchdogAlarm();
  await recreateScheduledAutoApplyAlarm({ catchUp: true, reason: 'startup' });
  await resumeScheduledRepair();
});

chrome.alarms?.onAlarm?.addListener?.((alarm) => {
  if (alarm?.name === RESPONSE_NAVIGATION_WATCHDOG_ALARM) {
    handleResponseNavigationWatchdogAlarm().catch((error) => {
      appendAgentLog('response_navigation_watchdog_error', {
        alarm: alarm.name,
        error: localizeError(error)
      }).catch(() => {});
    });
    return;
  }
  if (alarm?.name === SCHEDULED_AUTO_APPLY_ALARM) {
    (async () => {
      await recreateScheduledAutoApplyAlarm({ catchUp: false, reason: 'alarm_fired' });
      await runScheduledAutoApply();
    })().catch((error) => {
      appendAgentLog('scheduled_auto_apply_error', {
        alarm: alarm.name,
        error: localizeError(error)
      }).catch(() => {});
    });
  }
});

chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
  if (areaName !== 'local' || !SCHEDULED_AUTO_APPLY_SETTING_KEYS.some((key) => Object.hasOwn(changes || {}, key))) return;
  recreateScheduledAutoApplyAlarm({ catchUp: false, reason: 'settings_changed' }).catch((error) => {
    appendAgentLog('scheduled_auto_apply_alarm_error', { error: localizeError(error) }).catch(() => {});
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

async function terminalizeClosedAutoApplyOwner(stored, tabId) {
  const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
  if (lease?.active !== true || normalizeRunOwnerId(lease.ownerId) !== normalizeRunOwnerId(tabId)) {
    return { terminalized: false, updates: {} };
  }
  const closedAt = nowIso();
  const runId = normalizeRunId(lease.runId);
  const ownerId = normalizeRunOwnerId(tabId);
  const belongsToClosedRun = (value) => (
    normalizeRunId(value?.runId) === runId && normalizeRunOwnerId(value?.ownerId) === ownerId
  );
  const attempts = Object.fromEntries(Object.entries(stored[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY] || {}).map(([key, attempt]) => {
    if (belongsToClosedRun(attempt) && !attempt?.finalizedAt && !attempt?.cancelledAt) {
      return [key, { ...attempt, cancelledAt: closedAt, cancelReason: 'owner_tab_closed' }];
    }
    return [key, attempt];
  }));
  const pending = belongsToClosedRun(stored.autoApplyPendingSubmit) && stored.autoApplyPendingSubmit?.item
    ? stored.autoApplyPendingSubmit
    : null;
  const runState = stored.runState || {};
  const pendingCounters = pending?.counters || {};
  const counters = {};
  for (const key of ['found', 'processed', 'applied', 'alreadyApplied', 'skipped', 'errors']) {
    counters[key] = Math.max(Number(runState[key]) || 0, Number(pendingCounters[key]) || 0);
  }
  if (pending) counters.errors += 1;
  const ownerCloseError = pending
    ? 'Вкладка запуска закрыта до подтверждения отклика.'
    : 'Вкладка запуска закрыта.';
  const runResults = Array.isArray(stored.runResults) ? stored.runResults : [];
  const pendingResult = pending ? {
    ...(pending.item || {}),
    status: 'error_pending_submit_owner_tab_closed',
    error: ownerCloseError,
    timestamp: closedAt
  } : null;
  const resultExists = pendingResult && runResults.some((item) => (
    String(item?.vacancyId || '') === String(pendingResult.vacancyId || '') &&
    item?.status === pendingResult.status
  ));
  const nextResults = pendingResult && !resultExists
    ? [...runResults.slice(-(AUTO_APPLY_RUN_RESULTS_LIMIT - 1)), pendingResult]
    : runResults;
  const session = stored[SCHEDULED_AUTO_APPLY_SESSION_KEY];
  const scheduledOwnerClosed = session &&
    normalizeRunId(session.runId) === runId &&
    normalizeRunOwnerId(session.ownerId) === ownerId &&
    !SCHEDULED_AUTO_APPLY_TERMINAL_STATES.has(session.state);
  const reviewIssues = scheduledOwnerClosed
    ? [...new Set([...(Array.isArray(session.reviewIssues) ? session.reviewIssues : []), 'owner_tab_closed'])].slice(0, 20)
    : [];
  const updates = {
    [AUTO_APPLY_RESPONSE_ATTEMPTS_KEY]: attempts,
    ...(pending ? { autoApplyPendingSubmit: null, runResults: nextResults } : {}),
    ...(belongsToClosedRun(stored.autoApplyQueue)
      ? { autoApplyQueue: { ...stored.autoApplyQueue, active: false } }
      : {}),
    ...(belongsToClosedRun(stored.autoApplySearchQueue)
      ? { autoApplySearchQueue: { ...stored.autoApplySearchQueue, active: false } }
      : {}),
    runState: {
      ...DEFAULTS.runState,
      ...runState,
      ...counters,
      state: 'error',
      runId,
      ownerId,
      currentAction: 'Запуск остановлен: вкладка закрыта',
      lastError: ownerCloseError,
      updatedAt: closedAt
    },
    [AUTO_APPLY_RUN_LEASE_KEY]: {
      ...lease,
      active: false,
      updatedAt: closedAt,
      releasedState: 'owner_tab_closed'
    },
    ...(scheduledOwnerClosed ? {
      [SCHEDULED_AUTO_APPLY_SESSION_KEY]: {
        ...session,
        state: 'error',
        stopReason: 'owner_tab_closed',
        reviewIssues,
        reviewRequired: true,
        updatedAt: closedAt,
        finishedAt: closedAt
      }
    } : {})
  };
  await storageSet(updates);
  Object.assign(stored, updates);
  if (pendingResult && !resultExists) {
    await appendAgentLog('run_result', pendingResult);
  }
  await appendAgentLog('run_state', updates.runState);
  await appendAgentLog('auto_apply_owner_tab_closed', {
    runId,
    ownerId,
    pendingSubmitCancelled: Boolean(pending),
    scheduledSessionTerminalized: Boolean(scheduledOwnerClosed)
  });
  return { terminalized: true, updates, pendingResult };
}

async function reconcileMissingAutoApplyOwnerLocked(stored) {
  const lease = stored[AUTO_APPLY_RUN_LEASE_KEY];
  const ownerId = normalizeRunOwnerId(lease?.ownerId);
  if (lease?.active !== true || !ownerId || !chrome.tabs?.get) return { terminalized: false };
  const ownerPresent = await chrome.tabs.get(ownerId).then(() => true).catch(() => false);
  if (ownerPresent) return { terminalized: false };
  return terminalizeClosedAutoApplyOwner(stored, ownerId);
}

async function reconcileMissingAutoApplyOwner() {
  return enqueueAutoApplyOwnership(async () => {
    const stored = await storageGet([
      AUTO_APPLY_RUN_LEASE_KEY,
      AUTO_APPLY_RESPONSE_ATTEMPTS_KEY,
      SCHEDULED_AUTO_APPLY_SESSION_KEY,
      'autoApplyPendingSubmit',
      'autoApplyQueue',
      'autoApplySearchQueue',
      'runState',
      'runResults'
    ]);
    return reconcileMissingAutoApplyOwnerLocked(stored);
  });
}

chrome.tabs?.onRemoved?.addListener?.((tabId) => {
  enqueueAutoApplyOwnership(async () => {
    const stored = await storageGet([
      AUTO_APPLY_RUN_LEASE_KEY,
      AUTO_APPLY_RESPONSE_ATTEMPTS_KEY,
      SCHEDULED_AUTO_APPLY_SESSION_KEY,
      'autoApplyPendingSubmit',
      'autoApplyQueue',
      'autoApplySearchQueue',
      'runState',
      'runResults'
    ]);
    await terminalizeClosedAutoApplyOwner(stored, tabId);
  }).catch((error) => {
    appendAgentLog('auto_apply_owner_tab_close_error', { tabId, error: localizeError(error) }).catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'GET_SAFE_STATUS_SNAPSHOT') {
      try {
        sendResponse({ ok: true, snapshot: await buildSafeStatusSnapshot() });
      } catch {
        // Status must fail closed without exposing runtime or storage details.
        sendResponse({ ok: false });
      }
      return;
    }

    if (message?.type === 'RUN_SAFE_STATUS_PREFLIGHT') {
      if (!isSafeHhStatusUrl(sender?.tab?.url)) {
        sendResponse({ ok: false });
        return;
      }
      try {
        sendResponse({ ok: true, ...(await runSafeStatusPreflight()) });
      } catch {
        // Safe status preflight never returns raw profile, provider, or runtime errors.
        sendResponse({ ok: false });
      }
      return;
    }

    await ensureDefaults();

    switch (message?.type) {
      case 'ACKNOWLEDGE_SCHEDULED_SESSION_REVIEW': {
        sendResponse(await acknowledgeScheduledSessionReview(message, sender));
        break;
      }
      case 'REQUEST_SCHEDULED_REPAIR_PAUSE': {
        sendResponse(await requestScheduledRepairPause(message, sender));
        break;
      }
      case 'AUTHORIZE_SCHEDULED_CONTINUATION': {
        sendResponse(await authorizeScheduledContinuation(message, sender));
        break;
      }
      case 'CHECKPOINT_SCHEDULED_REPAIR': {
        sendResponse(await checkpointScheduledRepair(message, sender));
        break;
      }
      case 'RESUME_SCHEDULED_AUTO_APPLY_AFTER_REPAIR': {
        if (!isSafeHhStatusUrl(sender?.tab?.url) || message?.authenticated !== true) {
          sendResponse({ ok: false, reason: 'authenticated_safe_status_required' });
          break;
        }
        sendResponse(await resumeScheduledRepair());
        break;
      }
      case 'CLAIM_AUTO_APPLY_RUN': {
        sendResponse(await claimAutoApplyRun(message, sender));
        break;
      }
      case 'CHECK_AUTO_APPLY_RUN_OWNERSHIP': {
        sendResponse(await checkAutoApplyRunOwnership(message, sender));
        break;
      }
      case 'RESUME_AUTO_APPLY_RUN': {
        sendResponse(await resumeAutoApplyRun(message, sender));
        break;
      }
      case 'WRITE_AUTO_APPLY_STATE': {
        sendResponse(await writeOwnedAutoApplyState(message, sender));
        break;
      }
      case 'RECORD_DAILY_APPLICATION': {
        sendResponse(await recordOwnedDailyApplication(message, sender));
        break;
      }
      case 'REGISTER_AUTO_APPLY_RESPONSE_ATTEMPT': {
        sendResponse(await registerAutoApplyResponseAttempt(message, sender));
        break;
      }
      case 'GET_AUTO_APPLY_RESPONSE_ATTEMPT': {
        sendResponse(await getAutoApplyResponseAttempt(message, sender));
        break;
      }
      case 'CONSUME_AUTO_APPLY_RESPONSE_ATTEMPT': {
        sendResponse({ ok: false, consumed: false, status: 'unsupported' });
        break;
      }
      case 'CANCEL_AUTO_APPLY_RESPONSE_ATTEMPT': {
        sendResponse(await cancelAutoApplyResponseAttempt(message, sender));
        break;
      }
      case 'FINALIZE_AUTO_APPLY_RESPONSE_ATTEMPT': {
        sendResponse(await finalizeAutoApplyResponseAttempt(message, sender));
        break;
      }
      case 'FINALIZE_AUTO_APPLY_PENDING_SUBMIT': {
        sendResponse(await finalizeAutoApplyPendingSubmit(message, sender));
        break;
      }
      case 'GET_STATUS': {
        await reconcileQuiescentStoppedLease();
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
        const stopSnapshot = await storageGet([
          'runState',
          AUTO_APPLY_RUN_LEASE_KEY,
          AUTO_APPLY_RESPONSE_ATTEMPTS_KEY,
          'autoApplyQueue',
          'autoApplySearchQueue',
          'autoApplyPendingSubmit'
        ]);
        const terminalState = ['complete', 'dry_run_complete', 'idle', 'stopped', 'error']
          .includes(String(stopSnapshot.runState?.state || ''));
        const unresolvedAttempt = Object.values(stopSnapshot[AUTO_APPLY_RESPONSE_ATTEMPTS_KEY] || {}).some((attempt) => (
          attempt && !attempt.finalizedAt && !attempt.cancelledAt
        ));
        const activeRuntime = Boolean(
          stopSnapshot[AUTO_APPLY_RUN_LEASE_KEY]?.active === true ||
          stopSnapshot.autoApplyQueue?.active === true ||
          stopSnapshot.autoApplySearchQueue?.active === true ||
          stopSnapshot.autoApplyPendingSubmit?.item ||
          unresolvedAttempt
        );
        if (terminalState && !activeRuntime) {
          await appendAgentLog('stop_run_ignored_terminal', {
            state: String(stopSnapshot.runState?.state || '')
          });
          sendResponse({ ok: true, alreadyTerminal: true });
          break;
        }
        await storageSet({
          autoApplyStopRequested: true,
          autoApplyStopRequestedAt: nowIso(),
          autoApplyStopReason: 'user_stop'
        });
        await setRunState({ state: 'stopped', currentAction: 'Остановлено', lastError: '' });
        sendResponse({ ok: true });
        break;
      }
      case 'SET_RUN_STATE': {
        if (message.runId) {
          const result = await mutateOwnedAutoApplyRun(message, sender, async (lease) => {
            const terminalGuard = await guardScheduledTerminalTransition(message, lease);
            if (!terminalGuard.allowed) {
              return { written: false, ...terminalGuard };
            }
            await setRunState(message.patch || {});
            await syncScheduledSessionForTerminalRun(message, lease);
            await releaseAutoApplyRunLeaseIfTerminalUnlocked(message, sender);
            return { written: true };
          });
          if (!result.ok) {
            sendResponse(result);
            break;
          }
          sendResponse(result);
          break;
        }
        sendResponse(await mutateUnscopedStateWithoutActiveRun(() => setRunState(message.patch || {})));
        break;
      }
      case 'APPEND_RUN_RESULT': {
        if (message.runId) {
          const result = await mutateOwnedAutoApplyRun(message, sender, async () => {
            if (message.ensure === true) {
              const { runResults = [] } = await storageGet(['runResults']);
              const exists = runResults.some((entry) => (
                String(entry?.vacancyId || '') === String(message.item?.vacancyId || '') &&
                String(entry?.status || '') === String(message.item?.status || '') &&
                (!message.item?.timestamp || entry?.timestamp === message.item.timestamp)
              ));
              if (exists) return { appended: false, exists: true };
            }
            await appendRunResult(message.item || {});
            return { appended: true };
          });
          if (!result.ok) {
            sendResponse(result);
            break;
          }
          sendResponse(result);
          break;
        }
        sendResponse(await mutateUnscopedStateWithoutActiveRun(() => appendRunResult(message.item || {})));
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
      case 'SET_AI_ENABLED': {
        sendResponse(await setAiEnabled(message));
        break;
      }
      case 'GENERATE_COVER_LETTER': {
        const result = await callAi({
          task: message.task || 'cover_letter',
          vacancyText: message.vacancyText || '',
          extraText: message.extraText || '',
          questions: message.questions || [],
          coverLetterRequested: message.coverLetterRequested === true,
          allowStructuredCoverLetter: message.allowStructuredCoverLetter === true
        }, { deadlineAt: message.deadlineAt });
        sendResponse({ ok: true, ...result });
        break;
      }
      case 'RECORD_AI_FALLBACK': {
        await recordAiQuotaFallback(message.task || 'test_assist', message.reason || 'local_fallback');
        sendResponse({ ok: true });
        break;
      }
      case 'BUILD_RESUME_PROFILE': {
        const result = await buildResumeProfile({ deadlineAt: message.deadlineAt });
        sendResponse({ ok: true, ...result });
        break;
      }
      case 'ENSURE_RESUME_PROFILE': {
        const result = await ensureResumeProfileAutoRefresh({ deadlineAt: message.deadlineAt });
        sendResponse({ ok: true, refreshed: true, profileAvailable: Boolean(result?.resumeProfileText) });
        break;
      }
      case 'GET_AUTOMATION_SETTINGS_AUDIT': {
        const result = await buildAutomationSettingsAudit();
        sendResponse({ ok: true, audit: result });
        break;
      }
      case 'EDIT_RESUME_PROFILE': {
        const result = await editResumeProfile(message.comment || '', { deadlineAt: message.deadlineAt });
        sendResponse({ ok: true, ...result });
        break;
      }
      case 'TEST_AI_PROVIDER': {
        const result = await testAiProvider(
          message.providerId,
          message.apiKey,
          Object.prototype.hasOwnProperty.call(message, 'apiKey'),
          message.ollamaModel
        );
        sendResponse(result);
        break;
      }
      case 'LIST_OLLAMA_MODELS': {
        const models = await listOllamaModels();
        sendResponse({ ok: true, provider: 'ollama', models });
        break;
      }
      case 'TEST_GROQ': {
        const result = await testAiProvider('groq');
        sendResponse(result);
        break;
      }
      case 'REFRESH_RESUMES_NOW': {
        const { resumeUrl } = await storageGet(['resumeUrl']);
        const resumeMissing = globalThis.HHJA_CONFIG_READINESS
          .evaluate({
            aiProvider: 'groq',
            aiProviderCredentials: { groq: { apiKey: 'unused' } },
            resumeUrl,
            coverPrompt: 'unused',
            employerQuestionPrompt: 'unused'
          })
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
    sendResponse({
      ok: false,
      error: localizeError(error),
      errorCode: error?.code || 'HHJA_UNKNOWN_ERROR',
      provider: error?.provider,
      task: error?.task,
      httpStatus: error?.httpStatus,
      providerErrorCode: error?.providerErrorCode
    });
  });

  return true;
});

ensureDefaults().catch((error) => {
  console.error('Ошибка запуска HH Job Assistant:', error);
});
