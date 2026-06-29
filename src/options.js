const DEFAULTS = globalThis.HHJA_DEFAULTS;

const GROQ_MODELS = new Set([
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b'
]);

const OLD_DEFAULT_COVER_PROMPT = 'Напиши короткое сопроводительное письмо для отклика на вакансию. Тон: деловой, уверенный, без выдуманного опыта.';
const EMPLOYMENT_PREFERENCE_VALUES = new Set(['individual_entrepreneur', 'labor_contract']);
const WORK_FORMAT_PREFERENCE_VALUES = new Set(['remote', 'hybrid', 'office']);

const fields = {
  groqApiKey: document.getElementById('groqApiKey'),
  groqModel: document.getElementById('groqModel'),
  resumeUrl: document.getElementById('resumeUrl'),
  resumeCacheTtlHours: document.getElementById('resumeCacheTtlHours'),
  expectedSalary: document.getElementById('expectedSalary'),
  employmentPreference: document.getElementById('employmentPreference'),
  workFormatPreference: document.getElementById('workFormatPreference'),
  coverPrompt: document.getElementById('coverPrompt'),
  employerQuestionPrompt: document.getElementById('employerQuestionPrompt'),
  dailyLimit: document.getElementById('dailyLimit'),
  delayMinMs: document.getElementById('delayMinMs'),
  delayMaxMs: document.getElementById('delayMaxMs'),
  agentDebugLogsEnabled: document.getElementById('agentDebugLogsEnabled')
};

const statusNode = document.getElementById('status');
let savedGroqKeyMasked = false;
let groqKeyDirty = false;

function localizeError(error, fallback) {
  return globalThis.HHJA_LOCALIZE_ERROR?.(error, fallback) || fallback || 'Внутренняя ошибка расширения.';
}

function setStatus(text, isError = false) {
  statusNode.textContent = text;
  statusNode.style.color = isError ? '#b91c1c' : '#475569';
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

function setMultiSelectValue(field, values) {
  const selected = new Set(values);
  for (const option of Array.from(field.options || [])) {
    option.selected = selected.has(option.value);
  }
}

function getMultiSelectValue(field, allowedValues) {
  const options = Array.from(field.selectedOptions || field.options || []);
  return [...new Set(options.filter((option) => option.selected && allowedValues.has(option.value)).map((option) => option.value))];
}

async function loadOptions() {
  const values = await chrome.storage.local.get(Object.keys({ ...DEFAULTS, groqApiKey: '' }));

  fields.groqApiKey.value = values.groqApiKey ? '********' : '';
  fields.groqApiKey.dataset.masked = values.groqApiKey ? 'true' : 'false';
  savedGroqKeyMasked = Boolean(values.groqApiKey);
  groqKeyDirty = false;
  fields.groqModel.value = GROQ_MODELS.has(values.groqModel) ? values.groqModel : DEFAULTS.groqModel;
  fields.resumeUrl.value = values.resumeUrl || DEFAULTS.resumeUrl;
  fields.resumeCacheTtlHours.value = values.resumeCacheTtlHours ?? DEFAULTS.resumeCacheTtlHours;
  fields.expectedSalary.value = values.expectedSalary || DEFAULTS.expectedSalary;
  setMultiSelectValue(fields.employmentPreference, normalizeMultiPreference(values.employmentPreference, EMPLOYMENT_PREFERENCE_VALUES));
  setMultiSelectValue(fields.workFormatPreference, normalizeMultiPreference(values.workFormatPreference, WORK_FORMAT_PREFERENCE_VALUES));
  fields.coverPrompt.value = values.coverPrompt === OLD_DEFAULT_COVER_PROMPT
    ? DEFAULTS.coverPrompt
    : values.coverPrompt || DEFAULTS.coverPrompt;
  fields.employerQuestionPrompt.value = values.employerQuestionPrompt || DEFAULTS.employerQuestionPrompt;
  fields.dailyLimit.value = values.dailyLimit ?? DEFAULTS.dailyLimit;
  fields.delayMinMs.value = values.delayMinMs ?? DEFAULTS.delayMinMs;
  fields.delayMaxMs.value = values.delayMaxMs ?? DEFAULTS.delayMaxMs;
  fields.agentDebugLogsEnabled.checked = values.agentDebugLogsEnabled === true;
}

async function saveOptions() {
  const current = await chrome.storage.local.get(['resumeUrl']);
  const normalizedResumeUrl = fields.resumeUrl.value.trim();
  if (normalizedResumeUrl) {
    try {
      const parsed = new URL(normalizedResumeUrl);
      if (parsed.protocol !== 'https:' || (parsed.hostname !== 'hh.ru' && !parsed.hostname.endsWith('.hh.ru')) || !/^\/resume\/[^/?#]+/.test(parsed.pathname)) {
        throw new Error('invalid_resume_url');
      }
    } catch {
      fields.resumeUrl.setCustomValidity('Укажите ссылку на резюме hh.ru вида https://hh.ru/resume/...');
      fields.resumeUrl.reportValidity();
      throw new Error('Укажите ссылку на резюме hh.ru вида https://hh.ru/resume/...');
    }
  }
  fields.resumeUrl.setCustomValidity('');

  const patch = {
    groqModel: GROQ_MODELS.has(fields.groqModel.value) ? fields.groqModel.value : DEFAULTS.groqModel,
    resumeUrl: normalizedResumeUrl,
    resumeCacheTtlHours: Math.max(0.1, Math.min(Number(fields.resumeCacheTtlHours.value) || DEFAULTS.resumeCacheTtlHours, 168)),
    expectedSalary: fields.expectedSalary.value.trim(),
    employmentPreference: getMultiSelectValue(fields.employmentPreference, EMPLOYMENT_PREFERENCE_VALUES),
    workFormatPreference: getMultiSelectValue(fields.workFormatPreference, WORK_FORMAT_PREFERENCE_VALUES),
    coverPrompt: fields.coverPrompt.value.trim() || DEFAULTS.coverPrompt,
    employerQuestionPrompt: fields.employerQuestionPrompt.value.trim() || DEFAULTS.employerQuestionPrompt,
    dailyLimit: Math.max(1, Math.min(Number(fields.dailyLimit.value) || DEFAULTS.dailyLimit, 100)),
    delayMinMs: Math.max(500, Number(fields.delayMinMs.value) || DEFAULTS.delayMinMs),
    delayMaxMs: Math.max(500, Number(fields.delayMaxMs.value) || DEFAULTS.delayMaxMs),
    agentDebugLogsEnabled: fields.agentDebugLogsEnabled.checked
  };

  if (patch.delayMaxMs < patch.delayMinMs) {
    patch.delayMaxMs = patch.delayMinMs;
  }

  if ((current.resumeUrl || '') !== patch.resumeUrl) {
    patch.resumeParsedText = '';
    patch.resumeParsedAt = '';
    patch.resumeGroqBriefText = '';
    patch.resumeGroqBriefSourceHash = '';
    patch.resumeGroqBriefBuiltAt = '';
    patch.resumeGroqBriefVersion = '';
  }

  if (fields.groqApiKey.dataset.masked !== 'true' && (!savedGroqKeyMasked || groqKeyDirty)) {
    patch.groqApiKey = fields.groqApiKey.value.trim();
  }

  await chrome.storage.local.set(patch);
  if (!patch.agentDebugLogsEnabled) {
    await chrome.storage.local.remove(['agentDebugLog', 'agentDebugLogFile', 'agentDebugLogText']);
  }
  await loadOptions();
  setStatus('Сохранено.');
}

async function testGroq() {
  setStatus('Проверяю Groq...');
  const response = await chrome.runtime.sendMessage({ type: 'TEST_GROQ' });
  if (!response?.ok) {
    setStatus(localizeError(response?.error, 'Проверка Groq не прошла.'), true);
    return;
  }
  setStatus('Groq работает.');
}

fields.groqApiKey.addEventListener('focus', () => {
  if (fields.groqApiKey.dataset.masked === 'true') {
    fields.groqApiKey.value = '';
    fields.groqApiKey.dataset.masked = 'false';
  }
});

fields.groqApiKey.addEventListener('input', () => {
  groqKeyDirty = true;
});

document.getElementById('save').addEventListener('click', () => {
  saveOptions().catch((error) => setStatus(localizeError(error), true));
});

document.getElementById('testGroq').addEventListener('click', () => {
  testGroq().catch((error) => setStatus(localizeError(error), true));
});

loadOptions().catch((error) => setStatus(localizeError(error), true));
