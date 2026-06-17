(function installDefaults() {
  globalThis.HHJA_DEFAULTS = {
    groqModel: 'llama-3.3-70b-versatile',
    resumeText: '',
    resumeUrl: '',
    resumeParsedText: '',
    resumeParsedAt: '',
    resumeCacheTtlHours: 1,
    expectedSalary: '',
    coverPrompt: 'Напиши сопроводительное письмо на русском: 3-4 коротких предложения, без плейсхолдеров, без шаблонных скобок, без выдуманного опыта. Только готовый текст письма.',
    dailyLimit: 100,
    delayMinMs: 1500,
    delayMaxMs: 3000,
    chatUnreadOnly: true,
    chatReplyMode: 'draft',
    chatLimit: 10,
    runState: {
      state: 'idle',
      found: 0,
      processed: 0,
      applied: 0,
      skipped: 0,
      errors: 0,
      lastError: '',
      currentAction: '',
      updatedAt: null
    },
    runResults: [],
    chatReports: []
  };
})();
