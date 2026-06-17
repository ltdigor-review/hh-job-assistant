(function installErrorTextLocalizer() {
  function rawErrorText(error) {
    if (error instanceof Error) return error.message || error.name || '';
    if (typeof error === 'string') return error;
    if (error && typeof error.message === 'string') return error.message;
    return error == null ? '' : String(error);
  }

  function hasRussianText(text) {
    return /[А-Яа-яЁё]/.test(text);
  }

  function isMostlyTechnicalEnglish(text) {
    return /[A-Za-z]{3,}/.test(text) && !hasRussianText(text);
  }

  function localizeError(error, fallback = 'Внутренняя ошибка расширения. Подробности см. в техническом логе.') {
    const text = rawErrorText(error).trim();
    if (!text) return fallback;

    if (/could not establish connection|receiving end does not exist/i.test(text)) {
      return 'Нет связи с вкладкой hh.ru. Обновите страницу и повторите действие.';
    }
    if (/message port closed|port closed before a response/i.test(text)) {
      return 'Связь с вкладкой прервалась. Повторите действие после загрузки страницы.';
    }
    if (/extension context invalidated|context invalidated/i.test(text)) {
      return 'Контекст расширения устарел. Перезагрузите расширение и обновите страницу HH.';
    }
    if (/no tab with id|no tab/i.test(text)) {
      return 'Вкладка закрыта или недоступна. Откройте hh.ru и повторите действие.';
    }
    if (/cannot access|permission|permissions/i.test(text)) {
      return 'Нет доступа к текущей вкладке. Откройте страницу hh.ru и повторите действие.';
    }
    if (/failed to fetch|networkerror|network error|load failed|err_/i.test(text)) {
      return 'Не удалось подключиться к сервису. Проверьте интернет и повторите действие.';
    }
    if (/groq api key is not configured/i.test(text)) {
      return 'Ключ Groq API не настроен.';
    }
    if (/groq request failed:\s*429|rate limit|groq .*ограничил|пауза до|cooldown/i.test(text)) {
      return 'Groq временно ограничил запросы. Повторите позже.';
    }
    if (/timed out|timeout/i.test(text)) {
      return 'Операция не уложилась во время. Повторите действие позже.';
    }

    if (hasRussianText(text)) return text;
    if (isMostlyTechnicalEnglish(text)) return fallback;
    return text;
  }

  globalThis.HHJA_LOCALIZE_ERROR = localizeError;
  globalThis.HHJA_RAW_ERROR_TEXT = rawErrorText;
})();
