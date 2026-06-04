const DEFAULTS = {
  groqModel: 'llama-3.3-70b-versatile',
  resumeUrl: '',
  expectedSalary: '',
  coverPrompt: 'Напиши сопроводительное письмо на русском: 3-4 коротких предложения, без плейсхолдеров, без шаблонных скобок, без выдуманного опыта. Только готовый текст письма.',
  dailyLimit: 20,
  delayMinMs: 8000,
  delayMaxMs: 15000
};

const OLD_DEFAULT_COVER_PROMPT = 'Напиши короткое сопроводительное письмо для отклика на вакансию. Тон: деловой, уверенный, без выдуманного опыта.';

const fields = {
  groqApiKey: document.getElementById('groqApiKey'),
  groqModel: document.getElementById('groqModel'),
  resumeUrl: document.getElementById('resumeUrl'),
  expectedSalary: document.getElementById('expectedSalary'),
  coverPrompt: document.getElementById('coverPrompt'),
  dailyLimit: document.getElementById('dailyLimit'),
  delayMinMs: document.getElementById('delayMinMs'),
  delayMaxMs: document.getElementById('delayMaxMs')
};

const statusNode = document.getElementById('status');

function setStatus(text, isError = false) {
  statusNode.textContent = text;
  statusNode.style.color = isError ? '#b91c1c' : '#475569';
}

async function loadOptions() {
  const values = await chrome.storage.local.get(Object.keys({ ...DEFAULTS, groqApiKey: '' }));

  fields.groqApiKey.value = values.groqApiKey ? '********' : '';
  fields.groqApiKey.dataset.masked = values.groqApiKey ? 'true' : 'false';
  fields.groqModel.value = values.groqModel || DEFAULTS.groqModel;
  fields.resumeUrl.value = values.resumeUrl || DEFAULTS.resumeUrl;
  fields.expectedSalary.value = values.expectedSalary || DEFAULTS.expectedSalary;
  fields.coverPrompt.value = values.coverPrompt === OLD_DEFAULT_COVER_PROMPT
    ? DEFAULTS.coverPrompt
    : values.coverPrompt || DEFAULTS.coverPrompt;
  fields.dailyLimit.value = values.dailyLimit ?? DEFAULTS.dailyLimit;
  fields.delayMinMs.value = values.delayMinMs ?? DEFAULTS.delayMinMs;
  fields.delayMaxMs.value = values.delayMaxMs ?? DEFAULTS.delayMaxMs;
}

async function saveOptions() {
  const current = await chrome.storage.local.get(['resumeUrl']);
  const patch = {
    groqModel: fields.groqModel.value.trim() || DEFAULTS.groqModel,
    resumeUrl: fields.resumeUrl.value.trim(),
    expectedSalary: fields.expectedSalary.value.trim(),
    coverPrompt: fields.coverPrompt.value.trim() || DEFAULTS.coverPrompt,
    dailyLimit: Math.max(1, Math.min(Number(fields.dailyLimit.value) || DEFAULTS.dailyLimit, 100)),
    delayMinMs: Math.max(1000, Number(fields.delayMinMs.value) || DEFAULTS.delayMinMs),
    delayMaxMs: Math.max(1000, Number(fields.delayMaxMs.value) || DEFAULTS.delayMaxMs)
  };

  if (patch.delayMaxMs < patch.delayMinMs) {
    patch.delayMaxMs = patch.delayMinMs;
  }

  if ((current.resumeUrl || '') !== patch.resumeUrl) {
    patch.resumeParsedText = '';
    patch.resumeParsedAt = '';
  }

  if (fields.groqApiKey.dataset.masked !== 'true' || fields.groqApiKey.value !== '********') {
    patch.groqApiKey = fields.groqApiKey.value.trim();
  }

  await chrome.storage.local.set(patch);
  await loadOptions();
  setStatus('Saved.');
}

async function testGroq() {
  setStatus('Testing Groq...');
  const response = await chrome.runtime.sendMessage({ type: 'TEST_GROQ' });
  if (!response?.ok) {
    setStatus(response?.error || 'Groq test failed.', true);
    return;
  }
  setStatus(`Groq OK. Sample length: ${response.sampleLength}`);
}

fields.groqApiKey.addEventListener('focus', () => {
  if (fields.groqApiKey.dataset.masked === 'true') {
    fields.groqApiKey.value = '';
    fields.groqApiKey.dataset.masked = 'false';
  }
});

document.getElementById('save').addEventListener('click', () => {
  saveOptions().catch((error) => setStatus(error instanceof Error ? error.message : String(error), true));
});

document.getElementById('testGroq').addEventListener('click', () => {
  testGroq().catch((error) => setStatus(error instanceof Error ? error.message : String(error), true));
});

loadOptions().catch((error) => setStatus(error instanceof Error ? error.message : String(error), true));
