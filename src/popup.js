import { derivePopupView } from './popup-view.js';

function localizeError(error, fallback) {
  return globalThis.HHJA_LOCALIZE_ERROR?.(error, fallback) || fallback || 'Внутренняя ошибка расширения.';
}

const nodes = {
  appStatus: document.getElementById('appStatus'),
  appStatusTitle: document.getElementById('appStatusTitle'),
  appStatusDetail: document.getElementById('appStatusDetail'),
  currentAction: document.getElementById('currentAction'),
  applied: document.getElementById('applied'),
  skipped: document.getElementById('skipped'),
  errors: document.getElementById('errors'),
  recentResults: document.getElementById('recentResults'),
  version: document.getElementById('version'),
  autoApply: document.getElementById('autoApply'),
  continueApply: document.getElementById('continueApply'),
  stop: document.getElementById('stop'),
  refreshResumes: document.getElementById('refreshResumes')
};

nodes.version.textContent = `v${chrome.runtime.getManifest().version}`;

let lastRunState = { state: 'idle' };
let lastTabState = { kind: 'tab_unavailable', error: 'Проверяю вкладку' };
let hasGroqKey = false;
let copyToastTimeout = null;

async function copyText(text) {
  const value = String(text || '').trim();
  if (!value) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function showCopyToast() {
  document.querySelector('.copy-toast')?.remove();
  if (copyToastTimeout) {
    clearTimeout(copyToastTimeout);
  }

  const toast = document.createElement('div');
  toast.className = 'copy-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = 'Скопировано';
  document.body.append(toast);
  copyToastTimeout = setTimeout(() => {
    toast.remove();
    copyToastTimeout = null;
  }, 1000);
}

function renderView() {
  const view = derivePopupView({
    runState: lastRunState,
    tabState: lastTabState,
    hasGroqKey
  });

  nodes.appStatus.className = `panel status-panel ${view.status.tone}`;
  nodes.appStatusTitle.textContent = view.status.title;
  nodes.appStatusDetail.textContent = view.status.detail;

  nodes.currentAction.textContent = view.currentAction.title;

  nodes.applied.textContent = view.counters.applied;
  nodes.skipped.textContent = view.counters.skipped;
  nodes.errors.textContent = view.counters.errors;

  nodes.autoApply.disabled = view.buttons.autoApplyDisabled;
  nodes.autoApply.textContent = view.buttons.autoApplyLabel;
  nodes.continueApply.disabled = view.buttons.continueDisabled;
  nodes.stop.disabled = view.buttons.stopDisabled;
  nodes.refreshResumes.disabled = view.buttons.refreshResumesDisabled;
  nodes.autoApply.title = view.buttons.autoApplyTitle;
  nodes.continueApply.title = view.buttons.continueTitle;
  nodes.stop.title = view.buttons.stopTitle;
}

function resultMessage(item) {
  if (item.status === 'skipped_missing_groq_key') {
    return `Пропущено: ${item.title || item.vacancyId || 'вакансия'} требует сопроводительное письмо, но ключ Groq API не указан.`;
  }
  if (item.status === 'skipped_test_missing_groq_key') {
    return `Пропущено: ${item.title || item.vacancyId || 'вакансия'} требует ответы на вопросы работодателя или тест, но ключ Groq API не указан.`;
  }
  if (item.status === 'skipped_hh_daily_response_limit') {
    return 'Исчерпан лимит в 200 откликов в день. HH временно не дает отправлять новые отклики.';
  }
  if (/^skipped/.test(item.status || '')) {
    return `Пропущено: ${item.title || item.vacancyId || 'вакансия'} — ${localizeError(item.error || item.status)}`;
  }
  if (item.status === 'error') {
    return `Ошибка: ${item.title || item.vacancyId || 'вакансия'} — ${localizeError(item.error, 'неизвестная ошибка')}`;
  }
  if (/^applied/.test(item.status || '')) {
    return `Отправлено: ${item.title || item.vacancyId || 'вакансия'}`;
  }
  return `${item.status || 'Результат'}: ${item.title || item.vacancyId || 'вакансия'}`;
}

function resultClass(item) {
  if (/^skipped|missing_groq_key/.test(item.status || '')) return 'result warn';
  if (item.status === 'error') return 'result error';
  return 'result';
}

function renderResults(runResults = []) {
  const items = runResults.slice(-20).reverse();
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'result';
    empty.textContent = 'Действий пока нет.';
    nodes.recentResults.replaceChildren(empty);
    return;
  }

  nodes.recentResults.replaceChildren(
    ...items.map((item) => {
      const node = document.createElement('div');
      node.className = resultClass(item);
      const message = resultMessage(item);
      const text = document.createElement('div');
      text.className = 'result-text';
      text.textContent = message;
      if (node.classList.contains('warn') || node.classList.contains('error')) {
        node.classList.add('copyable');
        const copy = document.createElement('button');
        copy.className = 'copy-button';
        copy.type = 'button';
        copy.title = 'Копировать ошибку';
        copy.setAttribute('aria-label', 'Копировать ошибку');
        copy.dataset.copyText = message;
        copy.textContent = '⧉';
        node.append(copy, text);
      } else {
        node.append(text);
      }
      return node;
    })
  );
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

function isHhUrl(url) {
  return url?.protocol === 'https:' && (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru'));
}

function isAutoApplyStartUrl(url) {
  return url?.protocol === 'https:' &&
    (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru')) &&
    url.pathname === '/search/vacancy' &&
    url.search.length > 0;
}

async function readTabState() {
  try {
    const tab = await getActiveTab();
    const url = parseTabUrl(tab);
    if (!isHhUrl(url)) {
      return { kind: 'not_hh' };
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTENT_STATUS' });
    if (!response?.ok) {
      return { kind: 'tab_unavailable', error: localizeError(response?.error, 'Нет ответа от вкладки') };
    }
    if (response.unsafe || !response.authenticated) {
      return { kind: 'unauthenticated' };
    }

    return {
      kind: 'ready',
      canStartAutoApply: isAutoApplyStartUrl(url),
      canContinueAutoApply: response.canContinueAutoApply === true
    };
  } catch (error) {
    return {
      kind: 'tab_unavailable',
      error: localizeError(error)
    };
  }
}

async function readRuntimeState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (!response?.ok) {
      return { kind: 'extension_error', error: localizeError(response?.error, 'Расширение вернуло ошибку') };
    }
    lastRunState = response.runState || { state: 'idle' };
    renderResults(response.runResults || []);
    return null;
  } catch (error) {
    return {
      kind: 'extension_error',
      error: localizeError(error)
    };
  }
}

async function refreshPopup() {
  const [settings, runtimeError] = await Promise.all([
    chrome.storage.local.get(['groqApiKey']),
    readRuntimeState()
  ]);
  hasGroqKey = Boolean(settings.groqApiKey);
  lastTabState = runtimeError || await readTabState();

  renderView();
}

async function sendToActiveTab(type) {
  const tab = await getActiveTab();
  const url = parseTabUrl(tab);
  if (!isHhUrl(url)) {
    throw new Error('Сначала откройте вкладку hh.ru');
  }
  if (type === 'START_AUTO_APPLY' && !isAutoApplyStartUrl(url)) {
    throw new Error('Запуск откликов доступен только со страницы https://hh.ru/search/vacancy?...');
  }
  return chrome.tabs.sendMessage(tab.id, { type });
}

async function runContentAction(type, label) {
  const optimisticState = type === 'STOP_RUN' ? 'stopped' : type === 'START_AUTO_APPLY' ? 'scanning' : 'applying';
  lastRunState = {
    ...lastRunState,
    state: optimisticState,
    currentAction: label
  };
  renderView();
  const response = await sendToActiveTab(type);
  if (!response?.ok) {
    lastRunState = { state: 'error', lastError: localizeError(response?.error, 'Действие не выполнено') };
  }
  await refreshPopup();
}

async function stopRunNow() {
  lastRunState = {
    ...lastRunState,
    state: 'stopped',
    currentAction: 'Остановлено'
  };
  renderView();
  const response = await chrome.runtime.sendMessage({ type: 'STOP_RUN' });
  if (response?.ok === false) {
    throw new Error(localizeError(response.error, 'Остановка не выполнена'));
  }
  try {
    const tabResponse = await sendToActiveTab('STOP_RUN');
    if (tabResponse?.ok === false) {
      throw new Error(localizeError(tabResponse.error, 'Остановка не выполнена'));
    }
  } catch {
    // Durable stop flag in storage is enough for the running HH tab to stop on its next poll.
  }
  await refreshPopup();
}

async function runRuntimeAction(type, label, activeState) {
  lastRunState = { ...lastRunState, state: activeState, currentAction: label };
  renderView();
  const response = await chrome.runtime.sendMessage({ type });
  if (!response?.ok) {
    lastRunState = { state: 'error', lastError: localizeError(response?.error, 'Действие не выполнено') };
  }
  await refreshPopup();
}

nodes.autoApply.addEventListener('click', () => {
  runContentAction('START_AUTO_APPLY', 'Запускаю отклики...').catch((error) => {
    lastRunState = { state: 'error', lastError: localizeError(error) };
    renderView();
  });
});

nodes.continueApply.addEventListener('click', () => {
  runContentAction('CONTINUE_AUTO_APPLY', 'Продолжаю отклики...').catch((error) => {
    lastRunState = { state: 'error', lastError: localizeError(error) };
    renderView();
  });
});

nodes.stop.addEventListener('click', () => {
  stopRunNow().catch((error) => {
    lastRunState = { state: 'error', lastError: localizeError(error) };
    renderView();
  });
});

nodes.refreshResumes.addEventListener('click', () => {
  runRuntimeAction('REFRESH_RESUMES_NOW', 'Поднимаем резюме...', 'refreshing_resumes').catch((error) => {
    lastRunState = { state: 'error', lastError: localizeError(error) };
    renderView();
  });
});

nodes.recentResults.addEventListener('click', (event) => {
  const button = event.target.closest?.('button[data-copy-text]');
  if (!button) return;
  copyText(button.dataset.copyText).then(() => {
    showCopyToast(button);
  }).catch((error) => {
    lastRunState = { state: 'error', lastError: localizeError(error, 'Не удалось скопировать ошибку') };
    renderView();
  });
});

document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

refreshPopup().catch((error) => {
  lastRunState = { state: 'error', lastError: localizeError(error) };
  renderView();
});

setInterval(() => {
  refreshPopup().catch(() => {});
}, 1000);
