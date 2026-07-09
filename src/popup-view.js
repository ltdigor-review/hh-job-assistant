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
  refreshing_resumes: 'Поднимаем резюме'
};

export const ACTIVE_RUN_STATES = new Set([
  'scanning',
  'applying',
  'waiting_for_dialog',
  'generating_cover_letter',
  'filling_cover_letter',
  'submitting',
  'refreshing_resumes'
]);

const RESTART_LABEL_STATES = new Set(['paused', 'stopped', 'complete', 'error']);

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

function isAutoApplyInProgress(runState = {}, tabState = {}) {
  return isActiveRun(runState) || tabState.autoApplyInProgress === true;
}

function deriveStatus({ runState = {}, tabState = {}, hasGroqKey = false }) {
  const lastError = localizeError(runState.lastError);
  if (runState.state === 'error') {
    return {
      tone: 'error',
      title: `Ошибка: ${lastError || 'действие остановлено'}`,
      detail: 'Проверьте текущую вкладку и повторите запуск'
    };
  }

  if (isAutoApplyInProgress(runState, tabState)) {
    return {
      tone: 'ok',
      title: isActiveRun(runState) ? STATE_LABELS[runState.state] : 'Отправка откликов',
      detail: normalizeText(runState.currentAction) || 'Отклики запущены'
    };
  }

  if (lastError) {
    return {
      tone: 'error',
      title: `Ошибка: ${lastError}`,
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

  if (tabState.kind === 'ready' && !tabState.canStartAutoApply) {
    return {
      tone: 'warn',
      title: 'Откройте поиск или форму отклика',
      detail: 'Запуск откликов доступен со страницы поиска вакансий или формы отклика HH'
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

function deriveAutoApplyTitle({ activeRun, tabReady, tabState }) {
  if (activeRun) return 'Дождитесь завершения текущего запуска';
  if (!tabReady) return 'Откройте вкладку hh.ru';
  if (!tabState.canStartAutoApply) return 'Откройте поиск вакансий или форму отклика HH';
  return 'Запустить отклики с текущей страницы HH';
}

function deriveStopTitle(activeRun) {
  return activeRun ? 'Остановить текущий запуск' : 'Нет активного запуска';
}

function deriveContinueTitle({ activeRun, tabReady, canContinue }) {
  if (activeRun) return 'Сначала остановите или дождитесь завершения текущего запуска';
  if (!tabReady) return 'Откройте вкладку hh.ru';
  return canContinue ? 'Продолжить сохраненный запуск откликов' : 'Нет сохраненного запуска для продолжения';
}

export function derivePopupView({
  runState = {},
  tabState = {},
  hasGroqKey = false
} = {}) {
  const activeRun = isAutoApplyInProgress(runState, tabState);
  const tabReady = tabState.kind === 'ready';
  const canContinue = tabReady && tabState.canContinueAutoApply === true;
  const restartLabel = RESTART_LABEL_STATES.has(runState.state);
  return {
    status: deriveStatus({ runState, tabState, hasGroqKey }),
    currentAction: deriveCurrentAction(runState),
    buttons: {
      autoApplyDisabled: activeRun || !tabReady || !tabState.canStartAutoApply,
      autoApplyLabel: restartLabel ? 'Запуск' : 'Запуск откликов',
      continueDisabled: activeRun || !canContinue,
      stopDisabled: !activeRun,
      refreshResumesDisabled: activeRun || !tabReady,
      autoApplyTitle: deriveAutoApplyTitle({ activeRun, tabReady, tabState }),
      continueTitle: deriveContinueTitle({ activeRun, tabReady, canContinue }),
      stopTitle: deriveStopTitle(activeRun)
    },
    counters: {
      found: runState.found ?? 0,
      applied: runState.applied ?? 0,
      skipped: runState.skipped ?? 0,
      errors: runState.errors ?? 0
    }
  };
}
