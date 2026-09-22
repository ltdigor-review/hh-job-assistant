(function installConfigReadiness() {
  function providerId(config) {
    if (!config.aiProvider && String(config.groqApiKey || '').trim()) return 'groq';
    return globalThis.HHJA_AI_PROVIDERS?.normalizeProviderId?.(config.aiProvider) ||
      (config.aiProvider === 'groq' ? 'groq' : 'qwen');
  }

  function providerApiKey(config) {
    const id = providerId(config);
    return globalThis.HHJA_AI_PROVIDERS?.getApiKey?.(config, id) ||
      String(config.aiProviderCredentials?.[id]?.apiKey || '').trim() ||
      (id === 'groq' ? String(config.groqApiKey || '').trim() : '');
  }

  function providerNeedsCredential(id) {
    return !globalThis.HHJA_AI_PROVIDERS?.getProvider?.(id)?.local;
  }

  function evaluate(config = {}) {
    const aiEnabled = config.aiEnabled !== false;
    const selectedProvider = providerId(config);
    const providerLabel = globalThis.HHJA_AI_PROVIDERS?.getProvider?.(selectedProvider)?.label ||
      `${selectedProvider.charAt(0).toUpperCase()}${selectedProvider.slice(1)}`;
    const required = [
      ...(aiEnabled && providerNeedsCredential(selectedProvider) ? [['ai_provider_api_key', `ключ ${providerLabel} API`, () => Boolean(providerApiKey(config))]] : []),
      ['resume_url', 'ссылка на резюме hh.ru', (value) => {
      try {
        const url = new URL(String(value || '').trim());
        return url.protocol === 'https:' && (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru')) && /^\/resume\/[^/?#]+/.test(url.pathname);
      } catch {
        return false;
      }
      }]
    ];
    const missing = required
      .filter(([code, , valid]) => !valid(code === 'resume_url' ? config.resumeUrl : undefined))
      .map(([code, label]) => ({ code, label }));
    return { ready: missing.length === 0, missing, provider: selectedProvider, aiEnabled };
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
