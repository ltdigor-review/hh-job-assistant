# HH Job Assistant Test Run: Russian UI Regression

## Metadata

- Test run ID: `2026-06-13-russian-ui-regression`
- Tester: Codex
- Date/time: `2026-06-13 20:08:28 MSK`
- Branch/commit: `codex/fix-russian-ui-texts` / `1c41519` plus working-tree changes
- Extension version: `0.1.63`
- Chrome version: Chrome for Testing from Playwright cache for isolated smoke
- Chrome profile: temporary isolated profile for `test:extension`; `.hhja-chromium-profile` for `test:hh:chromium`
- OS: macOS
- hh.ru login confirmed: yes for `.hhja-chromium-profile`
- Groq key available: not required for this regression run
- Resume URL configured: not required for this regression run
- Live side-effect permission granted: yes, per active repository acceptance permission
- Permission scope: browser UI/browser automation, live hh.ru smoke checks, no real application submission requested in this run
- Evidence: terminal output from commands below

## Command Evidence

- [x] `node --test --test-name-pattern "extension user-facing text is localized" tests/extension-build.test.mjs`
  - Result: pass, 1/1.
- [x] `npm test`
  - Result: pass, 96/96.
- [x] `npm run test:extension`
  - Result: pass.
  - Evidence: extension loaded with id `ohcopjcjekbfmlplembcbjocilnginmj`, version `0.1.63`.
- [x] `npm run test:hh:chromium`
  - Result: pass.
  - Evidence: `authenticated: true`, `found: 5`, `stateMessages: 1`.
- [B] `npm run test:hh`
  - Result: blocked.
  - Blocker: Chrome DevTools not reachable at `http://127.0.0.1:9222`; script reported `fetch failed`.

## Checklist Results

- [x] Test data and permissions: recorded above; live smoke allowed by repository acceptance permission.
- [x] Automated regression: `npm test` passed 96/96.
- [x] Install/load extension: covered by `npm run test:extension`.
- [x] First popup open: covered by popup wiring tests and localized text regression.
- [x] hh.ru page connection: covered by `npm run test:hh:chromium`.
- [x] Groq key from popup: covered by popup wiring tests; live Groq call not required for localization bug.
- [x] Options page settings: covered by options tests and localized text regression.
- [x] Vacancy preview: covered by `content-auto-apply.test.mjs`.
- [x] Auto-apply start guards: covered by `content-auto-apply.test.mjs`.
- [x] Auto-apply basic flow: covered by `content-auto-apply.test.mjs` and `hh-ui-flow.test.mjs`.
- [x] Auto-apply cover letter: covered by Groq missing-key and timeout fallback tests.
- [x] Employer questions and tests: covered by text/radio/checkbox/bad-output tests.
- [x] hh.ru response dialog edge cases: covered by blocked modal, country warning, missing submit, and timeout recovery tests.
- [x] Pagination and queue resume: covered by queue and pagination tests.
- [x] Stop flow: covered by stop-run test.
- [x] Keyboard command: covered by extension build tests.
- [x] Resume refresh: covered by `resume-refresh.test.mjs`.
- [x] Chat assistant navigation/filtering/draft/auto-send/external contact: covered by `content-chat-assist.test.mjs`.
- [x] Reports and debug log: covered by popup/background tests.
- [x] Safety and error states: covered by login/captcha, missing Groq, Groq timeout, invalidated context, and selector-missing tests.

## Notes

- New localization regression blocks known English UI strings in manifest, popup, options, content text validation, content script errors, and background errors.
- `npm run test:hh` remains blocked until Chrome is started with remote debugging or `HH_CHROME_CDP_URL` is set.
