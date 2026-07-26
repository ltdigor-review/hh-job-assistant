const DEFAULTS = globalThis.HHJA_DEFAULTS;

const GROQ_MODELS = new Set([
  'openai/gpt-oss-120b'
]);

const OLD_DEFAULT_COVER_PROMPTS = new Set([
  'Напиши короткое сопроводительное письмо для отклика на вакансию. Тон: деловой, уверенный, без выдуманного опыта.',
  'Напиши сопроводительное письмо на русском: 3-4 коротких предложения, без плейсхолдеров, без шаблонных скобок, без выдуманного опыта. Только готовый текст письма.',
  'Напиши сопроводительное письмо на русском: 3-4 коротких предложения, до 450 символов. Без списков, заголовков, markdown, плейсхолдеров, шаблонных скобок, неизвестных имен и выдуманного опыта. Не пересказывай резюме или вакансию. Только готовый текст письма.',
  'Напиши короткий живой отклик на русском: 1-2 простых предложения, до 220 символов. Без обращения, канцелярита, HR-клише, списков, markdown, выдуманного опыта и пересказа резюме или вакансии. Только готовый текст.',
  'Напиши одну живую строку для отклика hh.ru: 70-160 символов, по-русски, без приветствия. Используй конкретное пересечение резюме и вакансии. Без канцелярита, HR-клише, markdown, списков и фраз "готов обсудить", "релевантный опыт". Только текст.',
  'Напиши одну живую строку для отклика hh.ru: 70-150 символов, по-русски, без приветствия. Пиши от первого лица и используй конкретное пересечение резюме и вакансии. Без канцелярита, HR-клише, markdown, списков и фраз "готов обсудить", "релевантный опыт", "соответствует требованиям". Только текст.',
  'Напиши одну живую строку для отклика hh.ru: 50-150 символов, по-русски, без приветствия. Пиши от первого лица и используй конкретное пересечение резюме и вакансии. Без канцелярита, HR-клише, markdown, списков и фраз "готов обсудить", "релевантный опыт", "соответствует требованиям". Только текст.'
]);
const EMPLOYMENT_PREFERENCE_VALUES = new Set(['individual_entrepreneur', 'labor_contract']);
const WORK_FORMAT_PREFERENCE_VALUES = new Set(['remote', 'hybrid', 'office']);

const fields = {
  groqApiKey: document.getElementById('groqApiKey'),
  groqModel: document.getElementById('groqModel'),
  resumeUrl: document.getElementById('resumeUrl'),
  resumeCacheTtlHours: document.getElementById('resumeCacheTtlHours'),
  resumeProfileText: document.getElementById('resumeProfileText'),
  resumeProfileEditComment: document.getElementById('resumeProfileEditComment'),
  resumeProfileAutoRefreshEnabled: document.getElementById('resumeProfileAutoRefreshEnabled'),
  resumeProfileWeaknesses: document.getElementById('resumeProfileWeaknesses'),
  expectedSalary: document.getElementById('expectedSalary'),
  telegramUsername: document.getElementById('telegramUsername'),
  employmentPreference: document.getElementById('employmentPreference'),
  workFormatPreference: document.getElementById('workFormatPreference'),
  coverPrompt: document.getElementById('coverPrompt'),
  employerQuestionPrompt: document.getElementById('employerQuestionPrompt'),
  dailyLimit: document.getElementById('dailyLimit'),
  delayMinMs: document.getElementById('delayMinMs'),
  delayMaxMs: document.getElementById('delayMaxMs'),
  agentDebugLogsEnabled: document.getElementById('agentDebugLogsEnabled'),
  agentDebugRetentionCount: document.getElementById('agentDebugRetentionCount'),
  agentDebugRunSelect: document.getElementById('agentDebugRunSelect'),
  downloadAgentDebugRun: document.getElementById('downloadAgentDebugRun')
};

const statusNode = document.getElementById('status');
const groqStatusNode = document.getElementById('groqStatus');
const agentDebugStatusNode = document.getElementById('agentDebugStatus');
const resumeProfileStatusNode = document.getElementById('resumeProfileStatus');
const resumeProfileButtons = [
  document.getElementById('buildResumeProfile'),
  document.getElementById('editResumeProfile')
];
let savedGroqKeyMasked = false;
let groqKeyDirty = false;
let agentDebugRuns = [];
let agentDebugDownloadInProgress = false;

function localizeError(error, fallback) {
  return globalThis.HHJA_LOCALIZE_ERROR?.(error, fallback) || fallback || 'Внутренняя ошибка расширения.';
}

function setStatus(text, isError = false, node = statusNode) {
  node.textContent = text;
  node.style.color = isError ? '#b91c1c' : '#475569';
}

function setGroqStatus(text, isError = false) {
  setStatus(text, isError, groqStatusNode);
}

function setResumeProfileStatus(text, isError = false) {
  setStatus(text, isError, resumeProfileStatusNode);
}

function debugLogApi() {
  return globalThis.HHJobAssistantLog || null;
}

function normalizeDebugRetention(value) {
  return debugLogApi()?.normalizeRetention?.(value) ??
    Math.max(1, Math.min(Number.parseInt(value, 10) || DEFAULTS.agentDebugRetentionCount, 20));
}

function formatDebugRunLabel(run) {
  const kindLabels = {
    auto_apply: 'Отклики',
    resume_refresh: 'Поднятие резюме'
  };
  const statusLabels = {
    running: 'выполняется',
    scanning: 'выполняется',
    applying: 'выполняется',
    waiting_for_dialog: 'выполняется',
    generating_cover_letter: 'выполняется',
    filling_cover_letter: 'выполняется',
    submitting: 'выполняется',
    refreshing_resumes: 'выполняется',
    complete: 'завершён',
    dry_run_complete: 'завершён',
    stopped: 'остановлен',
    paused: 'приостановлен',
    error: 'ошибка',
    interrupted: 'прерван'
  };
  const timestamp = Date.parse(run.createdAt || '');
  const date = Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'short',
        timeStyle: 'medium'
      }).format(new Date(timestamp))
    : 'без даты';
  const kind = kindLabels[run.kind] || 'Запуск';
  const status = run.inProgress ? 'выполняется' : (statusLabels[run.status] || run.status || 'статус неизвестен');
  const version = run.extensionVersion ? `v${run.extensionVersion}` : 'версия неизвестна';
  return `${date} · ${kind} · ${status} · ${version}`;
}

function syncDebugControls() {
  const enabled = fields.agentDebugLogsEnabled.checked;
  const hasRuns = agentDebugRuns.length > 0;
  fields.agentDebugRunSelect.disabled = !enabled || !hasRuns;
  fields.downloadAgentDebugRun.disabled = !enabled || !hasRuns || agentDebugDownloadInProgress;
}

function renderDebugRuns(runs, preferredRunId = '') {
  agentDebugRuns = Array.isArray(runs) ? runs : [];
  const selectedId = agentDebugRuns.some((run) => run.id === preferredRunId)
    ? preferredRunId
    : agentDebugRuns[0]?.id || '';
  const options = agentDebugRuns.length > 0
    ? agentDebugRuns.map((run) => {
        const option = document.createElement('option');
        option.value = run.id;
        option.textContent = formatDebugRunLabel(run);
        return option;
      })
    : (() => {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = fields.agentDebugLogsEnabled.checked
          ? 'Сохранённых запусков нет'
          : 'Логи выключены';
        return [option];
      })();
  fields.agentDebugRunSelect.replaceChildren(...options);
  fields.agentDebugRunSelect.value = selectedId;
  syncDebugControls();
}

async function loadDebugRuns() {
  const preferredRunId = fields.agentDebugRunSelect.value;
  const runs = fields.agentDebugLogsEnabled.checked
    ? await debugLogApi()?.listRuns?.() || []
    : [];
  renderDebugRuns(runs, preferredRunId);
}

async function downloadSelectedDebugRun() {
  const runId = fields.agentDebugRunSelect.value;
  if (!runId) {
    throw new Error('Выберите сохранённый запуск.');
  }
  agentDebugDownloadInProgress = true;
  syncDebugControls();
  setStatus('Готовлю файл…', false, agentDebugStatusNode);
  let objectUrl = '';
  try {
    const artifact = await debugLogApi()?.getArtifact?.(runId);
    if (!artifact?.available || !artifact.text || !artifact.name) {
      throw new Error('Лог выбранного запуска не найден.');
    }
    const blob = new Blob([artifact.text], { type: 'application/x-ndjson;charset=utf-8' });
    objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = artifact.name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setStatus('Файл .debug скачан.', false, agentDebugStatusNode);
  } finally {
    if (objectUrl) {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
    agentDebugDownloadInProgress = false;
    syncDebugControls();
  }
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

function getPreferenceInputs(field) {
  return Array.from(field.querySelectorAll('input[type="checkbox"]'));
}

function setMultiCheckboxValue(field, values) {
  const selected = new Set(values);
  for (const input of getPreferenceInputs(field)) {
    input.checked = selected.has(input.value);
  }
}

function getMultiCheckboxValue(field, allowedValues) {
  return [
    ...new Set(
      getPreferenceInputs(field)
        .filter((input) => input.checked && allowedValues.has(input.value))
        .map((input) => input.value)
    )
  ];
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
  fields.resumeProfileText.value = values.resumeProfileText || '';
  fields.resumeProfileAutoRefreshEnabled.checked = values.resumeProfileAutoRefreshEnabled === true;
  fields.resumeProfileWeaknesses.textContent = values.resumeProfileWeaknesses || 'Недостатки не обнаружены или аудит ещё не выполнен.';
  fields.expectedSalary.value = values.expectedSalary || DEFAULTS.expectedSalary;
  fields.telegramUsername.value = values.telegramUsername || DEFAULTS.telegramUsername;
  setMultiCheckboxValue(fields.employmentPreference, normalizeMultiPreference(values.employmentPreference, EMPLOYMENT_PREFERENCE_VALUES));
  setMultiCheckboxValue(fields.workFormatPreference, normalizeMultiPreference(values.workFormatPreference, WORK_FORMAT_PREFERENCE_VALUES));
  fields.coverPrompt.value = String(values.coverPrompt || '').trim() || DEFAULTS.coverPrompt;
  fields.employerQuestionPrompt.value = String(values.employerQuestionPrompt || '').trim() || DEFAULTS.employerQuestionPrompt;
  fields.dailyLimit.value = values.dailyLimit ?? DEFAULTS.dailyLimit;
  fields.delayMinMs.value = values.delayMinMs ?? DEFAULTS.delayMinMs;
  fields.delayMaxMs.value = values.delayMaxMs ?? DEFAULTS.delayMaxMs;
  fields.agentDebugLogsEnabled.checked = values.agentDebugLogsEnabled === true;
  fields.agentDebugRetentionCount.value = normalizeDebugRetention(
    values.agentDebugRetentionCount ?? DEFAULTS.agentDebugRetentionCount
  );
  await loadDebugRuns();
}

async function saveOptions() {
  const current = await chrome.storage.local.get([
    'resumeUrl',
    'agentDebugLogsEnabled',
    'agentDebugRetentionCount'
  ]);
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

  for (const [field, label] of [
    [fields.coverPrompt, 'промпт сопроводительного письма'],
    [fields.employerQuestionPrompt, 'промпт ответов работодателю']
  ]) {
    if (!field.value.trim()) {
      field.setCustomValidity(`Заполните ${label}.`);
      field.reportValidity();
      throw new Error(`Заполните ${label}.`);
    }
    field.setCustomValidity('');
  }

  const patch = {
    groqModel: GROQ_MODELS.has(fields.groqModel.value) ? fields.groqModel.value : DEFAULTS.groqModel,
    resumeUrl: normalizedResumeUrl,
    resumeCacheTtlHours: Math.max(0.1, Math.min(Number(fields.resumeCacheTtlHours.value) || DEFAULTS.resumeCacheTtlHours, 168)),
    resumeProfileText: fields.resumeProfileText.value.trim(),
    resumeProfileAutoRefreshEnabled: fields.resumeProfileAutoRefreshEnabled.checked,
    expectedSalary: fields.expectedSalary.value.trim(),
    telegramUsername: fields.telegramUsername.value.trim(),
    employmentPreference: getMultiCheckboxValue(fields.employmentPreference, EMPLOYMENT_PREFERENCE_VALUES),
    workFormatPreference: getMultiCheckboxValue(fields.workFormatPreference, WORK_FORMAT_PREFERENCE_VALUES),
    coverPrompt: fields.coverPrompt.value.trim(),
    employerQuestionPrompt: fields.employerQuestionPrompt.value.trim(),
    aiPromptsVersion: 2,
    dailyLimit: Math.max(1, Math.min(Number(fields.dailyLimit.value) || DEFAULTS.dailyLimit, 200)),
    delayMinMs: Math.max(500, Number(fields.delayMinMs.value) || DEFAULTS.delayMinMs),
    delayMaxMs: Math.max(500, Number(fields.delayMaxMs.value) || DEFAULTS.delayMaxMs),
    agentDebugLogsEnabled: fields.agentDebugLogsEnabled.checked,
    agentDebugRetentionCount: normalizeDebugRetention(fields.agentDebugRetentionCount.value)
  };

  if (patch.delayMaxMs < patch.delayMinMs) {
    patch.delayMaxMs = patch.delayMinMs;
  }

  if ((current.resumeUrl || '') !== patch.resumeUrl) {
    patch.resumeParsedText = '';
    patch.resumeParsedAt = '';
    patch.resumeParsedUrl = '';
    patch.resumeGroqBriefText = '';
    patch.resumeGroqBriefSourceHash = '';
    patch.resumeGroqBriefBuiltAt = '';
    patch.resumeGroqBriefVersion = '';
    patch.resumeProfileText = '';
    patch.resumeProfileWeaknesses = '';
    patch.resumeProfileSourceHash = '';
    patch.resumeProfileBuiltAt = '';
    patch.resumeProfileCheckedAt = '';
  }

  if (fields.groqApiKey.dataset.masked !== 'true' && (!savedGroqKeyMasked || groqKeyDirty)) {
    patch.groqApiKey = fields.groqApiKey.value.trim();
  }

  await chrome.storage.local.set(patch);
  if (!patch.agentDebugLogsEnabled) {
    await debugLogApi()?.clearHistory?.();
  } else {
    await debugLogApi()?.trimHistory?.(patch.agentDebugRetentionCount);
  }
  await loadOptions();
  setStatus('Настройки логов сохранены.', false, agentDebugStatusNode);
  setStatus('Сохранено.');
}

async function testGroq() {
  setGroqStatus('Проверяю Groq...');
  const patch = {
    groqModel: GROQ_MODELS.has(fields.groqModel.value) ? fields.groqModel.value : DEFAULTS.groqModel
  };
  if (fields.groqApiKey.dataset.masked !== 'true') {
    patch.groqApiKey = fields.groqApiKey.value.trim();
  }
  await chrome.storage.local.set(patch);
  const response = await chrome.runtime.sendMessage({ type: 'TEST_GROQ' });
  if (!response?.ok) {
    setGroqStatus(localizeError(response?.error, 'Проверка Groq не прошла.'), true);
    return;
  }
  setGroqStatus('Groq работает.');
}

async function runResumeProfileAction(type) {
  await saveOptions();
  if (type === 'BUILD_RESUME_PROFILE' && !fields.resumeUrl.value.trim()) {
    throw new Error('Укажите ссылку на резюме hh.ru перед заполнением промпта.');
  }
  const comment = fields.resumeProfileEditComment.value.trim();
  if (type === 'EDIT_RESUME_PROFILE' && !comment) {
    fields.resumeProfileEditComment.setCustomValidity('Напишите, что нужно изменить в промпте.');
    fields.resumeProfileEditComment.reportValidity();
    throw new Error('Напишите, что нужно изменить в промпте.');
  }
  fields.resumeProfileEditComment.setCustomValidity('');
  resumeProfileButtons.forEach((button) => { button.disabled = true; });
  setResumeProfileStatus(type === 'BUILD_RESUME_PROFILE' ? 'Читаю резюме и составляю промпт…' : 'Редактирую промпт…');
  try {
    const response = await chrome.runtime.sendMessage({ type, comment });
    if (!response?.ok) {
      throw new Error(response?.error || 'Не удалось обновить промпт с резюме.');
    }
    await loadOptions();
    if (type === 'EDIT_RESUME_PROFILE') fields.resumeProfileEditComment.value = '';
    setResumeProfileStatus(type === 'BUILD_RESUME_PROFILE' ? 'Промпт заполнен.' : 'Промпт отредактирован.');
  } finally {
    resumeProfileButtons.forEach((button) => { button.disabled = false; });
  }
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

fields.agentDebugLogsEnabled.addEventListener('change', () => {
  setStatus('Сохраните настройки, чтобы применить изменение.', false, agentDebugStatusNode);
  syncDebugControls();
});

fields.downloadAgentDebugRun.addEventListener('click', () => {
  downloadSelectedDebugRun().catch((error) => {
    setStatus(localizeError(error, 'Не удалось скачать .debug.'), true, agentDebugStatusNode);
  });
});

document.getElementById('save').addEventListener('click', () => {
  saveOptions().catch((error) => setStatus(localizeError(error), true));
});

document.getElementById('testGroq').addEventListener('click', () => {
  testGroq().catch((error) => setGroqStatus(localizeError(error), true));
});

document.getElementById('buildResumeProfile').addEventListener('click', () => {
  runResumeProfileAction('BUILD_RESUME_PROFILE').catch((error) => setResumeProfileStatus(localizeError(error), true));
});

document.getElementById('editResumeProfile').addEventListener('click', () => {
  runResumeProfileAction('EDIT_RESUME_PROFILE').catch((error) => setResumeProfileStatus(localizeError(error), true));
});

loadOptions().catch((error) => setStatus(localizeError(error), true));

chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
  if (
    areaName === 'local' &&
    (
      changes.agentDebugRunIndex ||
      changes.agentDebugActiveRunId ||
      changes.agentDebugLogsEnabled ||
      changes.agentDebugRetentionCount
    )
  ) {
    loadOptions().catch((error) => setStatus(localizeError(error), true, agentDebugStatusNode));
  }
});
