const DEFAULTS = globalThis.HHJA_DEFAULTS;
const AI_PROVIDERS = globalThis.HHJA_AI_PROVIDERS;

const EMPLOYMENT_PREFERENCE_VALUES = new Set(['individual_entrepreneur', 'labor_contract']);
const WORK_FORMAT_PREFERENCE_VALUES = new Set(['remote', 'hybrid', 'office']);

const fields = {
  aiEnabled: document.getElementById('aiEnabled'),
  aiProvider: document.getElementById('aiProvider'),
  credentialProvider: document.getElementById('credentialProvider'),
  aiProviderApiKey: document.getElementById('aiProviderApiKey'),
  aiFallbackProvider: document.getElementById('aiFallbackProvider'),
  aiFallbackSection: document.getElementById('aiFallbackSection'),
  fallbackCoverLetterTemplate: document.getElementById('fallbackCoverLetterTemplate'),
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
  scheduledAutoApplyEnabled: document.getElementById('scheduledAutoApplyEnabled'),
  scheduledAutoApplyTimeMsk: document.getElementById('scheduledAutoApplyTimeMsk'),
  scheduledAutoApplyLateWindowMinutes: document.getElementById('scheduledAutoApplyLateWindowMinutes'),
  scheduledAutoApplyFilterUrl: document.getElementById('scheduledAutoApplyFilterUrl'),
  scheduledAutoApplyMaxRepairAttempts: document.getElementById('scheduledAutoApplyMaxRepairAttempts'),
  scheduledAutoApplyRepairCutoffMsk: document.getElementById('scheduledAutoApplyRepairCutoffMsk'),
  agentDebugLogsEnabled: document.getElementById('agentDebugLogsEnabled'),
  agentDebugRetentionCount: document.getElementById('agentDebugRetentionCount'),
  agentDebugRunSelect: document.getElementById('agentDebugRunSelect'),
  downloadAgentDebugRun: document.getElementById('downloadAgentDebugRun')
};

const statusNode = document.getElementById('status');
const aiProviderStatusNode = document.getElementById('aiProviderStatus');
const aiProviderModelNode = document.getElementById('aiProviderModel');
const aiProviderApiKeyLabelNode = document.getElementById('aiProviderApiKeyLabel');
const aiProviderCredentialHintNode = document.getElementById('aiProviderCredentialHint');
const configuredProvidersNode = document.getElementById('configuredProviders');
const agentDebugStatusNode = document.getElementById('agentDebugStatus');
const resumeProfileStatusNode = document.getElementById('resumeProfileStatus');
const resumeProfileButtons = [
  document.getElementById('buildResumeProfile'),
  document.getElementById('editResumeProfile')
];
const testAiProviderButton = document.getElementById('testAiProvider');
const credentialDrafts = new Map();
let credentialEditorProviderId = '';
let aiProviderTestGeneration = 0;
let agentDebugRuns = [];
let agentDebugDownloadInProgress = false;
let aiModeSaving = false;
let aiModeLocked = false;

function localizeError(error, fallback) {
  return globalThis.HHJA_LOCALIZE_ERROR?.(error, fallback) || fallback || 'Внутренняя ошибка расширения.';
}

function setStatus(text, isError = false, node = statusNode) {
  node.textContent = text;
  node.style.color = isError ? '#b91c1c' : '#475569';
}

function setAiProviderStatus(text, isError = false) {
  setStatus(text, isError, aiProviderStatusNode);
}

function selectedProviderId() {
  return AI_PROVIDERS.normalizeProviderId(fields.aiProvider.value);
}

function isAiEnabled() {
  return fields.aiEnabled.checked;
}

function providers() {
  return Object.values(AI_PROVIDERS.PROVIDERS);
}

function createProviderOption(provider) {
  const option = document.createElement('option');
  option.value = provider.id;
  option.textContent = `${provider.label} (${provider.id})`;
  return option;
}

function populateProviderSelectors() {
  const providerOptions = () => providers().map(createProviderOption);
  fields.aiProvider.replaceChildren(...providerOptions());
  fields.credentialProvider.replaceChildren(...providerOptions());
}

function renderFallbackProviders(preferredValue = fields.aiFallbackProvider.value) {
  const off = document.createElement('option');
  off.value = '';
  off.textContent = 'Выключен';
  const options = providers()
    .filter((provider) => {
      const draft = credentialDrafts.get(provider.id);
      return provider.id !== selectedProviderId() && Boolean(String(draft?.apiKey || '').trim());
    })
    .map(createProviderOption);
  fields.aiFallbackProvider.replaceChildren(off, ...options);
  fields.aiFallbackProvider.value = options.some((option) => option.value === preferredValue)
    ? preferredValue
    : '';
  fields.aiFallbackSection.hidden = !isAiEnabled() || options.length === 0;
  fields.aiFallbackProvider.disabled = !isAiEnabled() || options.length === 0;
}

function renderAiModeControls() {
  const enabled = isAiEnabled();
  fields.aiEnabled.disabled = aiModeSaving || aiModeLocked;
  fields.aiEnabled.title = aiModeLocked ? 'Остановите запуск перед сменой режима ИИ' : '';
  fields.aiProvider.disabled = !enabled;
  testAiProviderButton.disabled = !enabled;
  fields.resumeProfileEditComment.disabled = !enabled;
  fields.resumeProfileAutoRefreshEnabled.disabled = !enabled;
  resumeProfileButtons.forEach((button) => { button.disabled = !enabled; });
  renderFallbackProviders();
  if (!enabled) {
    setResumeProfileStatus('ИИ выключен: автоматическое создание и обновление промпта с резюме недоступно.');
  } else if (/^ИИ выключен:/.test(resumeProfileStatusNode.textContent || '')) {
    setResumeProfileStatus('');
  }
}

function renderProviderControls() {
  const providerId = selectedProviderId();
  const provider = AI_PROVIDERS.getProvider(providerId);
  aiProviderModelNode.textContent = provider.settingsModelSummary;
  renderFallbackProviders();
}

function currentCredentialDraft(providerId = credentialEditorProviderId) {
  return credentialDrafts.get(providerId);
}

function captureCredentialDraft() {
  const draft = currentCredentialDraft();
  if (!draft || !draft.dirty || fields.aiProviderApiKey.dataset.masked === 'true') return;
  draft.apiKey = fields.aiProviderApiKey.value;
}

function renderConfiguredProviders() {
  configuredProvidersNode.textContent = providers()
    .map((provider) => {
      const draft = credentialDrafts.get(provider.id);
      const configured = Boolean(String(draft?.apiKey || '').trim());
      return `${provider.label} — ${configured ? 'настроен' : 'не настроен'}`;
    })
    .join(' · ');
}

function renderCredentialConfiguration() {
  renderConfiguredProviders();
  renderFallbackProviders();
}

function renderCredentialEditor(providerId = fields.credentialProvider.value) {
  captureCredentialDraft();
  credentialEditorProviderId = AI_PROVIDERS.normalizeProviderId(providerId);
  fields.credentialProvider.value = credentialEditorProviderId;
  const provider = AI_PROVIDERS.getProvider(credentialEditorProviderId);
  const draft = currentCredentialDraft();
  aiProviderApiKeyLabelNode.textContent = provider.credentialLabel || `Ключ ${provider.label} API`;
  aiProviderCredentialHintNode.textContent = provider.settingsModelSummary;
  fields.aiProviderApiKey.placeholder = provider.credentialPlaceholder || '';
  fields.aiProviderApiKey.value = draft?.masked && !draft?.dirty ? '********' : (draft?.apiKey || '');
  fields.aiProviderApiKey.dataset.masked = draft?.masked && !draft?.dirty ? 'true' : 'false';
  renderCredentialConfiguration();
}

async function persistCurrentCredential() {
  captureCredentialDraft();
  const providerId = AI_PROVIDERS.normalizeProviderId(fields.credentialProvider.value);
  const provider = AI_PROVIDERS.getProvider(providerId);
  const draft = credentialDrafts.get(providerId);
  const apiKey = String(draft?.apiKey || '').trim();
  const current = await chrome.storage.local.get([
    'aiProvider',
    'aiProviderCredentials',
    'aiFallbackProvider',
    'aiFallbackEnabled',
    'aiFallbackToGroq',
    'groqApiKey'
  ]);
  const credentials = AI_PROVIDERS.setApiKey(
    AI_PROVIDERS.normalizeCredentials(current.aiProviderCredentials, current.groqApiKey),
    providerId,
    apiKey
  );
  const patch = {
    aiProviderCredentials: credentials,
    groqApiKey: String(credentials.groq?.apiKey || '')
  };
  const storedFallbackProvider = AI_PROVIDERS.normalizeFallbackProvider(
    current,
    current.aiProvider || selectedProviderId()
  );
  if (!apiKey && (fields.aiFallbackProvider.value === providerId || storedFallbackProvider === providerId)) {
    patch.aiFallbackProvider = '';
    patch.aiFallbackEnabled = false;
    patch.aiFallbackToGroq = false;
  }
  await chrome.storage.local.set(patch);
  draft.apiKey = apiKey;
  draft.masked = Boolean(apiKey);
  draft.dirty = false;
  renderCredentialEditor(providerId);
  setAiProviderStatus(apiKey ? `Ключ ${provider.label} сохранён.` : `Ключ ${provider.label} удалён.`);
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
  const values = await chrome.storage.local.get(Object.keys({
    ...DEFAULTS,
    autoApplyRunLease: null,
    groqApiKey: '',
    aiFallbackEnabled: false
  }));
  const credentials = AI_PROVIDERS.normalizeCredentials(values.aiProviderCredentials, values.groqApiKey);

  populateProviderSelectors();
  fields.aiEnabled.checked = values.aiEnabled !== false;
  aiModeLocked = globalThis.HHJA_AI_MODE.isLocked(values);
  fields.fallbackCoverLetterTemplate.value =
    String(values.fallbackCoverLetterTemplate || '').trim() || DEFAULTS.fallbackCoverLetterTemplate;
  fields.aiProvider.value = AI_PROVIDERS.normalizeProviderId(values.aiProvider);
  credentialDrafts.clear();
  for (const provider of providers()) {
    const apiKey = String(credentials[provider.id]?.apiKey || '').trim();
    credentialDrafts.set(provider.id, {
      apiKey,
      masked: Boolean(apiKey),
      dirty: false
    });
  }
  renderProviderControls();
  renderFallbackProviders(AI_PROVIDERS.normalizeFallbackProvider(values, selectedProviderId()));
  renderCredentialEditor(selectedProviderId());
  renderAiModeControls();
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
  fields.scheduledAutoApplyEnabled.checked = values.scheduledAutoApplyEnabled === true;
  fields.scheduledAutoApplyTimeMsk.value = values.scheduledAutoApplyTimeMsk || DEFAULTS.scheduledAutoApplyTimeMsk;
  fields.scheduledAutoApplyLateWindowMinutes.value = values.scheduledAutoApplyLateWindowMinutes ?? DEFAULTS.scheduledAutoApplyLateWindowMinutes;
  fields.scheduledAutoApplyFilterUrl.value = values.scheduledAutoApplyFilterUrl || DEFAULTS.scheduledAutoApplyFilterUrl;
  fields.scheduledAutoApplyMaxRepairAttempts.value = values.scheduledAutoApplyMaxRepairAttempts ?? DEFAULTS.scheduledAutoApplyMaxRepairAttempts;
  fields.scheduledAutoApplyRepairCutoffMsk.value = values.scheduledAutoApplyRepairCutoffMsk || DEFAULTS.scheduledAutoApplyRepairCutoffMsk;
  fields.agentDebugLogsEnabled.checked = values.agentDebugLogsEnabled === true;
  fields.agentDebugRetentionCount.value = normalizeDebugRetention(
    values.agentDebugRetentionCount ?? DEFAULTS.agentDebugRetentionCount
  );
  await loadDebugRuns();
}

async function saveOptions() {
  const current = await chrome.storage.local.get([
    'aiProviderCredentials',
    'groqApiKey',
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

  const rawScheduledFilterUrl = fields.scheduledAutoApplyFilterUrl.value.trim();
  let normalizedScheduledFilterUrl = '';
  if (rawScheduledFilterUrl) {
    try {
      const parsed = new URL(rawScheduledFilterUrl);
      if (
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        !(parsed.hostname === 'hh.ru' || parsed.hostname.endsWith('.hh.ru')) ||
        parsed.pathname !== '/search/vacancy' ||
        !parsed.search
      ) throw new Error('invalid_scheduled_filter_url');
      normalizedScheduledFilterUrl = parsed.href;
    } catch {
      fields.scheduledAutoApplyFilterUrl.setCustomValidity('Укажите ссылку поиска HH вида https://hh.ru/search/vacancy?...');
      fields.scheduledAutoApplyFilterUrl.reportValidity();
      throw new Error('Укажите корректную ссылку поиска вакансий HH.');
    }
  }
  if (fields.scheduledAutoApplyEnabled.checked && !normalizedScheduledFilterUrl) {
    fields.scheduledAutoApplyFilterUrl.setCustomValidity('Для ежедневного запуска укажите ссылку поиска HH.');
    fields.scheduledAutoApplyFilterUrl.reportValidity();
    throw new Error('Для ежедневного запуска укажите ссылку поиска HH.');
  }
  fields.scheduledAutoApplyFilterUrl.setCustomValidity('');

  for (const [field, label] of [
    [fields.fallbackCoverLetterTemplate, 'шаблон сопроводительного письма без ИИ'],
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
    aiProvider: selectedProviderId(),
    aiFallbackProvider: fields.aiFallbackProvider.value,
    aiFallbackEnabled: Boolean(fields.aiFallbackProvider.value),
    aiFallbackToGroq: selectedProviderId() === 'qwen' && fields.aiFallbackProvider.value === 'groq',
    resumeUrl: normalizedResumeUrl,
    resumeCacheTtlHours: Math.max(0.1, Math.min(Number(fields.resumeCacheTtlHours.value) || DEFAULTS.resumeCacheTtlHours, 168)),
    resumeProfileText: fields.resumeProfileText.value.trim(),
    resumeProfileAutoRefreshEnabled: fields.resumeProfileAutoRefreshEnabled.checked,
    expectedSalary: fields.expectedSalary.value.trim(),
    telegramUsername: fields.telegramUsername.value.trim(),
    employmentPreference: getMultiCheckboxValue(fields.employmentPreference, EMPLOYMENT_PREFERENCE_VALUES),
    workFormatPreference: getMultiCheckboxValue(fields.workFormatPreference, WORK_FORMAT_PREFERENCE_VALUES),
    fallbackCoverLetterTemplate: fields.fallbackCoverLetterTemplate.value.trim(),
    coverPrompt: fields.coverPrompt.value.trim(),
    employerQuestionPrompt: fields.employerQuestionPrompt.value.trim(),
    aiPromptsVersion: 2,
    dailyLimit: Math.max(1, Math.min(Number(fields.dailyLimit.value) || DEFAULTS.dailyLimit, 200)),
    delayMinMs: Math.max(500, Number(fields.delayMinMs.value) || DEFAULTS.delayMinMs),
    delayMaxMs: Math.max(500, Number(fields.delayMaxMs.value) || DEFAULTS.delayMaxMs),
    scheduledAutoApplyEnabled: fields.scheduledAutoApplyEnabled.checked,
    scheduledAutoApplyTimeMsk: fields.scheduledAutoApplyTimeMsk.value || DEFAULTS.scheduledAutoApplyTimeMsk,
    scheduledAutoApplyLateWindowMinutes: Math.max(0, Math.min(
      Number.isFinite(Number(fields.scheduledAutoApplyLateWindowMinutes.value))
        ? Number(fields.scheduledAutoApplyLateWindowMinutes.value)
        : DEFAULTS.scheduledAutoApplyLateWindowMinutes,
      720
    )),
    scheduledAutoApplyFilterUrl: normalizedScheduledFilterUrl,
    scheduledAutoApplyMaxRepairAttempts: Math.max(1, Math.min(Number(fields.scheduledAutoApplyMaxRepairAttempts.value) || DEFAULTS.scheduledAutoApplyMaxRepairAttempts, 10)),
    scheduledAutoApplyRepairCutoffMsk: fields.scheduledAutoApplyRepairCutoffMsk.value || DEFAULTS.scheduledAutoApplyRepairCutoffMsk,
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

  captureCredentialDraft();
  let credentials = AI_PROVIDERS.normalizeCredentials(current.aiProviderCredentials, current.groqApiKey);
  for (const provider of providers()) {
    const draft = credentialDrafts.get(provider.id);
    if (draft?.dirty) {
      credentials = AI_PROVIDERS.setApiKey(credentials, provider.id, draft.apiKey);
    }
  }
  patch.aiProviderCredentials = credentials;
  patch.groqApiKey = String(credentials.groq?.apiKey || '');

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

async function testAiProvider() {
  if (!isAiEnabled()) {
    setAiProviderStatus('Включите ИИ, чтобы проверить провайдера.', true);
    return;
  }
  const generation = ++aiProviderTestGeneration;
  captureCredentialDraft();
  const providerId = AI_PROVIDERS.normalizeProviderId(fields.credentialProvider.value);
  const provider = AI_PROVIDERS.getProvider(providerId);
  setAiProviderStatus(`Проверяю ${provider.label}...`);
  const isCurrent = () =>
    generation === aiProviderTestGeneration && fields.credentialProvider.value === providerId;
  let response;
  try {
    const message = { type: 'TEST_AI_PROVIDER', providerId };
    const draft = credentialDrafts.get(providerId);
    if (draft?.dirty) message.apiKey = String(draft.apiKey || '').trim();
    response = await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (isCurrent()) setAiProviderStatus(localizeError(error, `Проверка ${provider.label} не прошла.`), true);
    return;
  }
  if (!isCurrent()) return;
  const taskLabels = { cover_letter: 'письмо', resume_profile_build: 'профиль резюме', test_assist: 'ответы на вопросы' };
  const checkSummary = Array.isArray(response?.checks)
    ? response.checks.map((check) => `${taskLabels[check.task] || 'проверка'} (${check.model}): ${check.ok ? 'OK' : 'ошибка'}`).join(' · ')
    : '';
  if (!response?.ok) {
    setAiProviderStatus([checkSummary, localizeError(response?.error, `Проверка ${provider.label} не прошла.`)].filter(Boolean).join('. '), true);
    return;
  }
  setAiProviderStatus(checkSummary || `${provider.label} работает.`);
}

async function runResumeProfileAction(type) {
  if (!isAiEnabled()) {
    throw new Error('Включите ИИ, чтобы работать с промптом резюме.');
  }
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
    renderAiModeControls();
  }
}

fields.aiProviderApiKey.addEventListener('focus', () => {
  if (fields.aiProviderApiKey.dataset.masked === 'true') {
    fields.aiProviderApiKey.value = '';
    fields.aiProviderApiKey.dataset.masked = 'false';
  }
});

fields.aiProviderApiKey.addEventListener('input', () => {
  const draft = currentCredentialDraft();
  if (!draft) return;
  draft.dirty = true;
  draft.masked = false;
  draft.apiKey = fields.aiProviderApiKey.value;
  renderCredentialConfiguration();
});

fields.credentialProvider.addEventListener('change', () => {
  aiProviderTestGeneration += 1;
  renderCredentialEditor(fields.credentialProvider.value);
  setAiProviderStatus('');
});

fields.aiProvider.addEventListener('change', () => {
  aiProviderTestGeneration += 1;
  renderProviderControls();
  setAiProviderStatus('');
});

fields.aiEnabled.addEventListener('change', async () => {
  aiProviderTestGeneration += 1;
  const enabled = isAiEnabled();
  aiModeSaving = true;
  renderAiModeControls();
  setAiProviderStatus('');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'SET_AI_ENABLED', enabled });
    if (!response?.ok) throw new Error(response?.error || 'Не удалось изменить режим ИИ.');
    setAiProviderStatus(response.queueInvalidated
      ? 'Режим сохранён. Начните новый запуск; история сохранена.'
      : 'Режим ИИ сохранён.');
  } catch (error) {
    setAiProviderStatus(localizeError(error), true);
  } finally {
    const stored = await chrome.storage.local.get(['aiEnabled', 'runState', 'autoApplyRunLease']);
    fields.aiEnabled.checked = stored.aiEnabled !== false;
    aiModeLocked = globalThis.HHJA_AI_MODE.isLocked(stored);
    aiModeSaving = false;
    renderAiModeControls();
  }
});

document.getElementById('saveProviderCredential').addEventListener('click', () =>
  persistCurrentCredential().catch((error) => {
    setAiProviderStatus(localizeError(error, 'Не удалось сохранить ключ.'), true);
  })
);

document.getElementById('deleteProviderCredential').addEventListener('click', () => {
  const draft = currentCredentialDraft();
  if (!draft) return;
  draft.apiKey = '';
  draft.masked = false;
  draft.dirty = true;
  fields.aiProviderApiKey.value = '';
  fields.aiProviderApiKey.dataset.masked = 'false';
  renderCredentialConfiguration();
  return persistCurrentCredential().catch((error) => {
    setAiProviderStatus(localizeError(error, 'Не удалось удалить ключ.'), true);
  });
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

testAiProviderButton.addEventListener('click', () => {
  testAiProvider();
});

document.getElementById('buildResumeProfile').addEventListener('click', () => {
  runResumeProfileAction('BUILD_RESUME_PROFILE').catch((error) => setResumeProfileStatus(localizeError(error), true));
});

document.getElementById('editResumeProfile').addEventListener('click', () => {
  runResumeProfileAction('EDIT_RESUME_PROFILE').catch((error) => setResumeProfileStatus(localizeError(error), true));
});

chrome.runtime.sendMessage({ type: 'GET_STATUS' })
  .then(() => loadOptions())
  .catch((error) => setStatus(localizeError(error), true));

chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
  if (areaName === 'local' && (changes.aiEnabled || changes.runState || changes.autoApplyRunLease)) {
    chrome.storage.local.get(['aiEnabled', 'runState', 'autoApplyRunLease']).then((stored) => {
      fields.aiEnabled.checked = stored.aiEnabled !== false;
      aiModeLocked = globalThis.HHJA_AI_MODE.isLocked(stored);
      renderAiModeControls();
    }).catch((error) => setAiProviderStatus(localizeError(error), true));
  }
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
