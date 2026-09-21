(function installAiMode() {
  const activeStates = new Set([
    'scanning', 'applying', 'waiting_for_dialog', 'generating_cover_letter',
    'filling_cover_letter', 'submitting', 'refreshing_resumes'
  ]);

  function isLocked({ runState = {}, autoApplyRunLease } = {}) {
    return autoApplyRunLease?.active === true || activeStates.has(runState?.state);
  }

  globalThis.HHJA_AI_MODE = { isLocked };
})();
