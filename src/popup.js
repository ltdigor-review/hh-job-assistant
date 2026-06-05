const nodes = {
  state: document.getElementById('state'),
  found: document.getElementById('found'),
  applied: document.getElementById('applied'),
  skipped: document.getElementById('skipped'),
  errors: document.getElementById('errors'),
  lastError: document.getElementById('lastError'),
  statusLine: document.getElementById('statusLine'),
  recentResults: document.getElementById('recentResults'),
  chatReports: document.getElementById('chatReports'),
  groqApiKey: document.getElementById('groqApiKey'),
  version: document.getElementById('version'),
  extensionStatus: document.getElementById('extensionStatus'),
  tabStatus: document.getElementById('tabStatus')
};

const STATE_LABELS = {
  idle: 'Ожидание',
  scanning: 'Поиск вакансий',
  dry_run_complete: 'Предпросмотр завершен',
  applying: 'Отправка откликов',
  waiting_for_dialog: 'Ожидание окна hh.ru',
  generating_cover_letter: 'Генерация письма',
  filling_cover_letter: 'Заполнение письма',
  submitting: 'Отправка',
  paused: 'Пауза',
  stopped: 'Остановлено',
  complete: 'Готово',
  error: 'Ошибка',
  refreshing_resumes: 'Обновление резюме',
  scanning_chat: 'Проверка чата',
  processing_chat: 'Обработка чата',
  generating_chat_reply: 'Генерация ответа',
  sending_chat_reply: 'Отправка ответа'
};

nodes.version.textContent = `v${chrome.runtime.getManifest().version}`;

function setHealth(node, text, state) {
  const dot = node.querySelector('.health-dot') || document.createElement('span');
  if (!dot.parentElement) {
    dot.className = 'health-dot';
    dot.setAttribute('aria-hidden', 'true');
  }
  node.className = `health-value ${state}`;
  node.replaceChildren(dot, document.createTextNode(text));
}

function setStatus(text, isError = false) {
  nodes.statusLine.textContent = text;
  nodes.statusLine.style.color = isError ? '#b91c1c' : '#475569';
}

function renderState(runState = {}) {
  nodes.state.textContent = STATE_LABELS[runState.state] || runState.state || 'Ожидание';
  nodes.found.textContent = runState.found ?? 0;
  nodes.applied.textContent = runState.applied ?? 0;
  nodes.skipped.textContent = runState.skipped ?? 0;
  nodes.errors.textContent = runState.errors ?? 0;
  nodes.lastError.textContent = runState.lastError || '';
  if (runState.currentAction) {
    setStatus(runState.currentAction, runState.state === 'error');
  } else if (runState.state === 'error') {
    setStatus('Остановлено из-за ошибки. См. детали ниже.', true);
  } else if ((runState.errors ?? 0) > 0) {
    setStatus('Завершено с ошибками. См. детали ниже.', true);
  } else if ((runState.skipped ?? 0) > 0) {
    setStatus('Завершено с пропусками. См. лог ниже.');
  } else if (runState.state === 'complete') {
    setStatus('Готово.');
  }
}

function resultMessage(item) {
  if (item.status === 'skipped_missing_groq_key') {
    return `Skipped: ${item.title || item.vacancyId || 'vacancy'} needs a cover letter, but Groq API key is missing.`;
  }
  if (item.status === 'skipped_test_missing_groq_key') {
    return `Skipped: ${item.title || item.vacancyId || 'vacancy'} needs employer questions/test assistance, but Groq API key is missing.`;
  }
  if (/^skipped/.test(item.status || '')) {
    return `Skipped: ${item.title || item.vacancyId || 'vacancy'} — ${item.error || item.status}`;
  }
  if (item.status === 'error') {
    return `Error: ${item.title || item.vacancyId || 'vacancy'} — ${item.error || 'unknown error'}`;
  }
  if (/^applied/.test(item.status || '')) {
    return `Applied: ${item.title || item.vacancyId || 'vacancy'}`;
  }
  return `${item.status || 'Result'}: ${item.title || item.vacancyId || 'vacancy'}`;
}

function resultClass(item) {
  if (/^skipped|missing_groq_key/.test(item.status || '')) return 'result warn';
  if (item.status === 'error') return 'result error';
  return 'result';
}

function renderResults(runResults = []) {
  const items = runResults.slice(-4).reverse();
  nodes.recentResults.replaceChildren(
    ...items.map((item) => {
      const node = document.createElement('div');
      node.className = resultClass(item);
      node.textContent = resultMessage(item);
      return node;
    })
  );
}

function reportMessage(item) {
  if (item.status === 'reported_external_contact') {
    return `External contact: ${item.employerName || item.vacancyTitle || 'chat'}`;
  }
  if (item.status === 'sent') {
    return `Sent: ${item.employerName || item.vacancyTitle || 'chat'}`;
  }
  if (item.status === 'drafted') {
    return `Drafted: ${item.employerName || item.vacancyTitle || 'chat'}`;
  }
  if (item.status === 'error') {
    return `Error: ${item.employerName || item.vacancyTitle || 'chat'} — ${item.error || 'unknown error'}`;
  }
  return `${item.status || 'Report'}: ${item.employerName || item.vacancyTitle || 'chat'}`;
}

function renderChatReports(chatReports = []) {
  const items = chatReports.slice(-5).reverse();
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'report';
    empty.textContent = 'No chat reports yet.';
    nodes.chatReports.replaceChildren(empty);
    return;
  }

  nodes.chatReports.replaceChildren(
    ...items.map((item) => {
      const node = document.createElement('div');
      node.className = 'report';

      const title = document.createElement('div');
      title.textContent = reportMessage(item);

      const link = document.createElement('a');
      link.href = item.chatUrl || 'https://hh.ru/chat';
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = item.chatUrl || 'https://hh.ru/chat';

      const detail = document.createElement('div');
      detail.textContent = item.contactText || item.reason || item.vacancyTitle || '';

      node.append(title, link);
      if (detail.textContent) node.append(detail);
      return node;
    })
  );
}

async function loadPopupSettings() {
  const values = await chrome.storage.local.get(['groqApiKey']);
  nodes.groqApiKey.value = values.groqApiKey ? '********' : '';
  nodes.groqApiKey.dataset.masked = values.groqApiKey ? 'true' : 'false';
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('Активная вкладка не найдена');
  }
  return tab;
}

function parseTabUrl(tab) {
  try {
    return new URL(tab.url || '');
  } catch {
    return null;
  }
}

function isAutoApplyStartUrl(url) {
  return url?.protocol === 'https:' &&
    url.hostname === 'hh.ru' &&
    url.pathname === '/search/vacancy' &&
    url.search.length > 0;
}

function isHhUrl(url) {
  return url?.protocol === 'https:' && (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru'));
}

async function sendToActiveTab(type) {
  const tab = await getActiveTab();
  const url = parseTabUrl(tab);
  const hostname = url?.hostname || '';
  if (hostname !== 'hh.ru' && !hostname.endsWith('.hh.ru')) {
    throw new Error('Сначала откройте вкладку hh.ru');
  }
  if (type === 'START_AUTO_APPLY' && !isAutoApplyStartUrl(url)) {
    throw new Error('Запуск откликов доступен только со страницы https://hh.ru/search/vacancy?...');
  }
  return chrome.tabs.sendMessage(tab.id, { type });
}

async function refreshHealth() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    setHealth(nodes.extensionStatus, response?.ok ? 'Готово к работе' : 'Ошибка', response?.ok ? 'ok' : 'error');
  } catch (error) {
    setHealth(nodes.extensionStatus, 'Не отвечает', 'error');
  }

  try {
    const tab = await getActiveTab();
    const url = parseTabUrl(tab);
    if (!isHhUrl(url)) {
      setHealth(nodes.tabStatus, 'Не hh.ru', 'warn');
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTENT_STATUS' });
    setHealth(nodes.tabStatus, response?.ok ? 'hh.ru подключен' : 'Нет связи', response?.ok ? 'ok' : 'error');
  } catch (error) {
    setHealth(nodes.tabStatus, 'Нет связи', 'error');
  }
}

async function refreshStatus() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  if (response?.ok) {
    renderState(response.runState);
    renderResults(response.runResults || []);
  }

  const reportsResponse = await chrome.runtime.sendMessage({ type: 'GET_CHAT_REPORTS' });
  if (reportsResponse?.ok) {
    renderChatReports(reportsResponse.chatReports || []);
  }
}

async function runContentAction(type, label) {
  setStatus(label);
  const response = await sendToActiveTab(type);
  if (!response?.ok) {
    setStatus(response?.error || 'Действие не выполнено', true);
    await refreshStatus();
    return;
  }
  await refreshStatus();
}

async function runRuntimeAction(type, label) {
  setStatus(label);
  const response = await chrome.runtime.sendMessage({ type });
  if (!response?.ok) {
    setStatus(response?.error || 'Действие не выполнено', true);
    await refreshStatus();
    return;
  }
  await refreshStatus();
  if (response.navigated) {
    setStatus('Открыл чат. Запустите еще раз после загрузки.');
  }
}

document.getElementById('dryRun').addEventListener('click', () => {
  runContentAction('START_DRY_RUN', 'Проверяю страницу перед отправкой...').catch((error) => setStatus(error.message, true));
});

document.getElementById('autoApply').addEventListener('click', () => {
  runContentAction('START_AUTO_APPLY', 'Запускаю отклики...').catch((error) => setStatus(error.message, true));
});

document.getElementById('stop').addEventListener('click', () => {
  runContentAction('STOP_RUN', 'Останавливаю...').catch((error) => setStatus(error.message, true));
});

document.getElementById('refreshResumes').addEventListener('click', async () => {
  try {
    setStatus('Обновляю резюме...');
    const response = await chrome.runtime.sendMessage({ type: 'REFRESH_RESUMES_NOW' });
    if (!response?.ok) {
      setStatus(response?.error || 'Не удалось обновить резюме', true);
    } else {
      setStatus('Резюме обновлены.');
    }
    await refreshStatus();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

document.getElementById('chatAssist').addEventListener('click', () => {
  runRuntimeAction('START_CHAT_ASSIST', 'Обрабатываю чат...').catch((error) => setStatus(error.message, true));
});

document.getElementById('clearReports').addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_CHAT_REPORTS' });
    setStatus('Chat reports cleared.');
    await refreshStatus();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

nodes.groqApiKey.addEventListener('focus', () => {
  if (nodes.groqApiKey.dataset.masked === 'true') {
    nodes.groqApiKey.value = '';
    nodes.groqApiKey.dataset.masked = 'false';
  }
});

document.getElementById('saveGroqKey').addEventListener('click', async () => {
  try {
    const patch = {};
    if (nodes.groqApiKey.dataset.masked !== 'true' || nodes.groqApiKey.value !== '********') {
      patch.groqApiKey = nodes.groqApiKey.value.trim();
    }
    await chrome.storage.local.set(patch);
    await loadPopupSettings();
    setStatus(patch.groqApiKey ? 'Groq key saved.' : 'Groq key cleared.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

document.getElementById('testGroq').addEventListener('click', async () => {
  try {
    setStatus('Testing Groq...');
    const response = await chrome.runtime.sendMessage({ type: 'TEST_GROQ' });
    if (!response?.ok) {
      setStatus(response?.error || 'Groq test failed.', true);
      return;
    }
    setStatus(`Groq OK. Sample length: ${response.sampleLength}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

loadPopupSettings().catch((error) => setStatus(error instanceof Error ? error.message : String(error), true));
refreshHealth().catch(() => {});
refreshStatus().catch((error) => setStatus(error instanceof Error ? error.message : String(error), true));
setInterval(() => {
  refreshHealth().catch(() => {});
  refreshStatus().catch(() => {});
}, 1000);
