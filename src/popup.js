const nodes = {
  state: document.getElementById('state'),
  found: document.getElementById('found'),
  processed: document.getElementById('processed'),
  applied: document.getElementById('applied'),
  skipped: document.getElementById('skipped'),
  errors: document.getElementById('errors'),
  lastError: document.getElementById('lastError'),
  statusLine: document.getElementById('statusLine')
};

const params = new URLSearchParams(location.search);
const isWindowMode = params.get('mode') === 'window';
if (isWindowMode) {
  document.body.classList.add('window-mode');
}

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
  refreshing_resumes: 'Обновление резюме'
};

function setStatus(text, isError = false) {
  nodes.statusLine.textContent = text;
  nodes.statusLine.style.color = isError ? '#b91c1c' : '#475569';
}

function renderState(runState = {}) {
  nodes.state.textContent = STATE_LABELS[runState.state] || runState.state || 'Ожидание';
  nodes.found.textContent = runState.found ?? 0;
  nodes.processed.textContent = runState.processed ?? 0;
  nodes.applied.textContent = runState.applied ?? 0;
  nodes.skipped.textContent = runState.skipped ?? 0;
  nodes.errors.textContent = runState.errors ?? 0;
  nodes.lastError.textContent = runState.lastError || '';
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('Активная вкладка не найдена');
  }
  return tab;
}

async function sendToActiveTab(type) {
  const tab = await getActiveTab();
  if (!/^https:\/\/hh\.ru\//.test(tab.url || '')) {
    throw new Error('Сначала откройте вкладку hh.ru');
  }
  return chrome.tabs.sendMessage(tab.id, { type });
}

async function refreshStatus() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  if (response?.ok) {
    renderState(response.runState);
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
  setStatus('Готово.');
  await refreshStatus();
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

document.getElementById('openWindow').addEventListener('click', async () => {
  try {
    setStatus('Открываю отдельное окно...');
    const response = await chrome.runtime.sendMessage({ type: 'OPEN_ASSISTANT_WINDOW' });
    if (!response?.ok) {
      setStatus(response?.error || 'Не удалось открыть отдельное окно', true);
      return;
    }
    setStatus('Окно открыто.');
    if (!isWindowMode) {
      window.close();
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

refreshStatus().catch((error) => setStatus(error instanceof Error ? error.message : String(error), true));
setInterval(() => {
  refreshStatus().catch(() => {});
}, 1000);
