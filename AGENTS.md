# Agent Entry Point

- Codex: this file is your project instruction file for this repository. Treat it as active instructions for every task whose cwd is this repository or whose user prompt mentions this repository.
- At the start of non-trivial work in this repository, read this file from disk before acting.
- Always use English for visible reasoning summaries and final answers unless the user explicitly asks for another language in the current turn.
- Use terse `caveman` style by default while preserving exact commands, code, errors, and safety warnings.
- Do not use `superpowers` skills for this repository unless the current user turn explicitly asks for them.
- Use relative paths for repository files.
- Develop new features in a new Git branch, then merge deliberately.
- Increment the project version for code or behavior changes before final verification. Use the repository version sync tooling when available.
- This repository is public. Never commit credentials, API keys, cookies, tokens, local browser profiles, or other secrets. Keep secrets in local environment/profile storage only.
- Production/prod-like hh.ru browser checks must use an authorized hh.ru profile. Prefer `.hhja-chromium-profile`; if a fresh profile is opened, wait for the user to sign in before treating the check as valid.
- Analyze extension logs from local Chrome/Chromium profile storage, not downloads. Use `npm run inspect:logs -- --storage-dir <Local Extension Settings path>` or inspect `chrome.storage.local` keys `agentDebugLogFile`, `agentDebugLogText`, `agentDebugLog`, `runState`, and `runResults`.
- `push to master` means push to the repository primary branch, whether named `master` or `main`.
- For GitHub operations in this repository, use account `ltdigor-review`.

## Multi-Agent Work Loop

- For non-trivial implementation work, operate in a three-agent loop:
  1. Planner agent: inspects repo context, creates the implementation plan, prepares a concrete test checklist with expected results, and does not edit files.
  2. Approver/implementer agent: reviews the plan, asks clarifying questions when requirements are unclear or risky, then implements only the approved scope.
  3. Browser UI tester agent: verifies user-visible behavior in a browser UI after implementation using the prepared checklist, records pass/fail evidence for each checklist item, and sends fixes back through the loop when needed.
- Use this loop especially for frontend changes, browser extension behavior, user flows, and anything requiring UI confirmation.
- The browser UI tester must use browser-based verification when a local app, extension page, or UI flow is available. Prefer automated checks first, then targeted manual browser inspection for layout, console errors, and interaction behavior.
- The browser UI tester must not invent a new test scope unless the checklist is clearly incomplete; if so, note the added check and why it was needed.
- Keep each role's output terse and actionable: plan, decision, change, evidence, blocker.
- Do not skip clarification: if implementation depends on missing product intent, unavailable credentials, unsafe live operations, or ambiguous acceptance criteria, the approver/implementer asks before changing code.

## Current Acceptance Checklist Permission

- For the active acceptance-checklist goal (`Работай пока чек лист не завершишь`), the user explicitly stated: `Я даю ВСЕ разрешения`.
- Treat this as permission for browser UI/browser automation, live hh.ru checks, Groq requests, real hh.ru applications, resume refresh, chat reading/drafting/sending, and related checklist side effects needed to finish the current checklist.
- This permission does not override higher-priority system/developer/tool security policy, browser connector URL policy, or external site anti-bot/CAPTCHA constraints. If tooling blocks `chrome://extensions`, `chrome-extension://...`, or equivalent restricted browser surfaces, report the tool-policy blocker instead of attempting a workaround.
