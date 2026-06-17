const DEFAULTS = globalThis.HHJA_DEFAULTS;

const GROQ_MODELS = new Set([
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b'
]);

const OLD_DEFAULT_COVER_PROMPT = 'Напиши короткое сопроводительное письмо для отклика на вакансию. Тон: деловой, уверенный, без выдуманного опыта.';

const fields = {
  groqApiKey: document.getElementById('groqApiKey'),
  groqModel: document.getElementById('groqModel'),
  resumeUrl: document.getElementById('resumeUrl'),
  resumeCacheTtlHours: document.getElementById('resumeCacheTtlHours'),
  expectedSalary: document.getElementById('expectedSalary'),
  coverPrompt: document.getElementById('coverPrompt'),
  dailyLimit: document.getElementById('dailyLimit'),
  delayMinMs: document.getElementById('delayMinMs'),
  delayMaxMs: document.getElementById('delayMaxMs'),
  experimentalFeaturesEnabled: document.getElementById('experimentalFeaturesEnabled'),
  chatUnreadOnly: document.getElementById('chatUnreadOnly'),
  chatReplyMode: document.getElementById('chatReplyMode'),
  chatLimit: document.getElementById('chatLimit')
};

const sections = {
  chatAssistantSettings: document.getElementById('chatAssistantSettings')
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

function syncExperimentalSections() {
  sections.chatAssistantSettings.hidden = !fields.experimentalFeaturesEnabled.checked;
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
  fields.coverPrompt.value = values.coverPrompt === OLD_DEFAULT_COVER_PROMPT
    ? DEFAULTS.coverPrompt
    : values.coverPrompt || DEFAULTS.coverPrompt;
  fields.dailyLimit.value = values.dailyLimit ?? DEFAULTS.dailyLimit;
  fields.delayMinMs.value = values.delayMinMs ?? DEFAULTS.delayMinMs;
  fields.delayMaxMs.value = values.delayMaxMs ?? DEFAULTS.delayMaxMs;
  fields.experimentalFeaturesEnabled.checked = values.experimentalFeaturesEnabled === true;
  syncExperimentalSections();
  fields.chatUnreadOnly.checked = values.chatUnreadOnly !== false;
  fields.chatReplyMode.value = values.chatReplyMode === 'auto_send' ? 'auto_send' : DEFAULTS.chatReplyMode;
  fields.chatLimit.value = values.chatLimit ?? DEFAULTS.chatLimit;
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
    coverPrompt: fields.coverPrompt.value.trim() || DEFAULTS.coverPrompt,
    dailyLimit: Math.max(1, Math.min(Number(fields.dailyLimit.value) || DEFAULTS.dailyLimit, 100)),
    delayMinMs: Math.max(500, Number(fields.delayMinMs.value) || DEFAULTS.delayMinMs),
    delayMaxMs: Math.max(500, Number(fields.delayMaxMs.value) || DEFAULTS.delayMaxMs),
    experimentalFeaturesEnabled: fields.experimentalFeaturesEnabled.checked,
    chatUnreadOnly: fields.chatUnreadOnly.checked,
    chatReplyMode: fields.chatReplyMode.value === 'auto_send' ? 'auto_send' : DEFAULTS.chatReplyMode,
    chatLimit: Math.max(1, Math.min(Number(fields.chatLimit.value) || DEFAULTS.chatLimit, 100))
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
  setStatus(`Groq работает. Длина примера: ${response.sampleLength}`);
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

fields.experimentalFeaturesEnabled.addEventListener('change', syncExperimentalSections);

document.getElementById('save').addEventListener('click', () => {
  saveOptions().catch((error) => setStatus(localizeError(error), true));
});

document.getElementById('testGroq').addEventListener('click', () => {
  testGroq().catch((error) => setStatus(localizeError(error), true));
});

loadOptions().catch((error) => setStatus(localizeError(error), true));
