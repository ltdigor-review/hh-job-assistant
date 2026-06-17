import './error-text.js';

export const STATE_LABELS = {
  idle: 'Ожидание',
  scanning: 'Поиск вакансий',
  dry_run_complete: 'Проверка завершена',
  applying: 'Отправка откликов',
  waiting_for_dialog: 'Ожидание окна hh.ru',
  generating_cover_letter: 'Составляем сопроводительное письмо',
  filling_cover_letter: 'Заполнение формы',
  submitting: 'Отправка',
  paused: 'Пауза',
  stopped: 'Остановлено',
  complete: 'Готово',
  error: 'Ошибка',
  refreshing_resumes: 'Поднимаем резюме',
  scanning_chat: 'Проверка чатов',
  processing_chat: 'Обработка чатов',
  generating_chat_reply: 'Готовим ответ в чат',
  sending_chat_reply: 'Отправляем ответ в чат'
};

export const ACTIVE_RUN_STATES = new Set([
  'scanning',
  'applying',
  'waiting_for_dialog',
  'generating_cover_letter',
  'filling_cover_letter',
  'submitting',
  'refreshing_resumes',
  'scanning_chat',
  'processing_chat',
  'generating_chat_reply',
  'sending_chat_reply'
]);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function localizeError(value) {
  const text = normalizeText(value);
  if (!text) return '';
  return globalThis.HHJA_LOCALIZE_ERROR?.(text) || text;
}

export function isActiveRun(runState = {}) {
  return ACTIVE_RUN_STATES.has(runState.state);
}

function deriveStatus({ runState = {}, tabState = {}, hasGroqKey = false }) {
  const lastError = localizeError(runState.lastError);
  if (runState.state === 'error' || lastError) {
    return {
      tone: 'error',
      title: `Ошибка: ${lastError || 'действие остановлено'}`,
      detail: 'Проверьте текущую вкладку и повторите запуск'
    };
  }

  if (tabState.kind === 'extension_error') {
    return {
      tone: 'error',
      title: 'Расширение не отвечает',
      detail: tabState.error || 'Перезагрузите расширение в Chrome'
    };
  }

  if (tabState.kind === 'not_hh') {
    return {
      tone: 'error',
      title: 'Откройте hh.ru',
      detail: 'Отклики запускаются со страницы поиска вакансий hh.ru'
    };
  }

  if (tabState.kind === 'unauthenticated') {
    return {
      tone: 'error',
      title: 'Войдите в hh.ru',
      detail: 'Авторизация нужна для откликов, резюме и чатов'
    };
  }

  if (tabState.kind === 'tab_unavailable') {
    return {
      tone: 'error',
      title: 'Нет связи с вкладкой',
      detail: tabState.error || 'Обновите вкладку hh.ru'
    };
  }

  if (!hasGroqKey) {
    return {
      tone: 'warn',
      title: 'ГОТОВО, без автоответов',
      detail: 'Вакансии с письмами/вопросами будут пропущены'
    };
  }

  return {
    tone: 'ok',
    title: 'ГОТОВО',
    detail: 'hh.ru открыт · Groq подключен'
  };
}

function deriveCurrentAction(runState = {}) {
  const title = normalizeText(runState.currentAction) || STATE_LABELS[runState.state] || 'Ожидание';
  if (runState.state === 'idle' || !runState.state) {
    return { title: 'Ожидание' };
  }
  return { title };
}

export function derivePopupView({ runState = {}, tabState = {}, hasGroqKey = false } = {}) {
  const activeRun = isActiveRun(runState);
  const tabReady = tabState.kind === 'ready';
  return {
    status: deriveStatus({ runState, tabState, hasGroqKey }),
    currentAction: deriveCurrentAction(runState),
    buttons: {
      autoApplyDisabled: activeRun || !tabReady || !tabState.canStartAutoApply,
      stopDisabled: !activeRun,
      refreshResumesDisabled: activeRun || !tabReady,
      chatAssistDisabled: activeRun || !tabReady
    },
    counters: {
      found: runState.found ?? 0,
      applied: runState.applied ?? 0,
      skipped: runState.skipped ?? 0,
      errors: runState.errors ?? 0
    }
  };
}
