(function installConfigReadiness() {
  const REQUIRED = [
    ['groq_api_key', 'ключ Groq API', (value) => Boolean(String(value || '').trim())],
    ['resume_url', 'ссылка на резюме hh.ru', (value) => {
      try {
        const url = new URL(String(value || '').trim());
        return url.protocol === 'https:' && (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru')) && /^\/resume\/[^/?#]+/.test(url.pathname);
      } catch {
        return false;
      }
    }]
  ];

  function evaluate(config = {}) {
    const missing = REQUIRED
      .filter(([code, label, valid]) => !valid(config[code === 'groq_api_key' ? 'groqApiKey' : code === 'resume_url' ? 'resumeUrl' : code.replace(/_([a-z])/g, (_, char) => char.toUpperCase())]))
      .map(([code, label]) => ({ code, label }));
    return { ready: missing.length === 0, missing };
  }

  function assertReady(config = {}) {
    const result = evaluate(config);
    if (!result.ready) {
      const error = new Error(`Приложение не настроено. Откройте настройки и заполните: ${result.missing.map((item) => item.label).join(', ')}.`);
      error.code = 'HHJA_CONFIG_NOT_READY';
      error.readiness = result;
      throw error;
    }
    return result;
  }

  globalThis.HHJA_CONFIG_READINESS = { evaluate, assertReady };
})();
