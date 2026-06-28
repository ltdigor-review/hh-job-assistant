# HH Job Assistant Acceptance Checklist

Date: 2026-06-08
Branch: `codex/fix-response-form-crash`
Extension version: `0.1.22`

## Scope

Acceptance testing covers:

- Extension manifest/build sanity.
- Popup health, actions, logs, Groq key masking.
- Options page settings and persistence.
- hh.ru vacancy page detection and preview.
- Auto-apply flow, including 20 consecutive responses and employer-question forms.
- Stop/resume/log behavior around auto-apply.
- Resume refresh flow.

## Checklist

| Status | Check | Evidence |
| --- | --- | --- |
| Done | Read repo instructions before work | `AGENTS.md` read from disk |
| Done | Map features from implementation | `README.md`, `manifest.json`, `src/background.js`, `src/content-hh.js`, `src/popup.js`, `src/options.js` inspected |
| Done | Run automated test suite | `npm test` passed 61/61 on 2026-06-08 |
| Done | Manifest/build sanity | Covered by `tests/extension-build.test.mjs`; 61/61 suite pass |
| Done | Auto-apply unit/DOM flows | Covered by `tests/content-auto-apply.test.mjs`; includes dry-run, question forms, choice retry, blocked forms, queued 30 applications, non-fatal Groq errors, apply-limit accounting, stop/log behavior, markdown stripping, and bad-answer skip |
| Done | Resume refresh unit/DOM flows | Covered by `tests/resume-refresh.test.mjs`; configured resume URL, save/raise, login/captcha errors |
| Done | Chrome/profile available | Chrome launched with Profile 1; HH Job Assistant pinned and visible |
| Done | hh.ru login/live page access | Live hh.ru vacancy search opened under logged-in account; no login/captcha shown |
| Done | Extension site access | Chrome toolbar showed HH Job Assistant has hh.ru access |
| Done | Popup health | Popup showed `Готово к работе` and `hh.ru подключен` |
| Done | Popup Groq key masking | Popup showed masked Groq key |
| Done | Options load current settings | Options showed model, resume URL, expected salary, employment preference, work format preference, delays, diagnostic mode, masked Groq key |
| Done | Options persistence | Daily apply limit changed to `20`, saved, status `Saved.` |
| Done | Vacancy preview on live hh.ru | Popup `Предпросмотр`: found `50`, skipped `8`, errors `0`; storage state `dry_run_complete` |
| Done | Live Groq API test | Live auto-apply generated answers through Groq; storage log has `groq_request_start`/`groq_request_complete` for `test_assist` |
| Done | Live auto-applications | Extension completed the permitted live application run; detailed local evidence stays in ignored `run-logs/` |
| Done | Auto-apply with employer questions | Live run included employer-question assisted applications; detailed local evidence stays in ignored `run-logs/` |
| Done | Stop/resume/log behavior | `tests/content-auto-apply.test.mjs` covers queued continuation/recovery and `STOP_RUN` clearing queues, setting `stopped`, and logging `stop_run` |
| Done | Resume refresh | `tests/resume-refresh.test.mjs` covers configured resume URL, edit/save/raise, raise-unavailable success, login/captcha, missing URL, non-hh active tab, missing buttons |
| Done | Debug log behavior | `tests/extension-build.test.mjs` covers diagnostic log storage behavior |

## Fixes During Acceptance

- Fixed non-fatal Groq/individual-vacancy failures stopping the whole auto-apply batch. Fatal login/captcha/anti-bot errors still stop the run.
- Fixed apply limit semantics so skipped cards do not count as successful applications.
- Added generated-text sanitization before filling hh.ru fields: strips markdown/code fences/headings/list markers/backticks.
- Added generated-answer validation before submit/draft: skips bad model output containing prompt labels, markdown artifacts, JSON/prompt metadata, refusal/filler text, or copied prompt context.
- Added stop/log acceptance coverage: `STOP_RUN` clears queues, records stopped state, and appends a `stop_run` debug event.

## Current Blocker

Resolved on 2026-06-08: user explicitly permitted live side-effect tests:

- Send data to Groq.
- Submit up to 20 hh.ru applications.
- Refresh/save resume.
Original live side-effect scope:

1. Send resume/profile, vacancy, and question text to Groq with saved Groq API key.
2. Submit up to 20 hh.ru job applications from current logged-in account, including employer-question forms.
3. Refresh/save configured hh.ru resume.

## Additional Notes

- Codex Chrome Extension browser API was unavailable even though Chrome, native host, and Codex Chrome Extension checks passed. Computer Use was used instead after user allowed UI/PC.
- `npm run test:hh` was not usable because Chrome DevTools was not running at `http://127.0.0.1:9222`.
- Current local extension storage showed live preview state; detailed local evidence stays in ignored `run-logs/`.
