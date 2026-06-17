# HH Job Assistant Test Checklist Template

Template version date: 2026-06-17
Extension version source: `manifest.json`, `package.json`

## How To Use This Template

- Keep this checklist current at all times.
- Any feature change, behavior change, UI copy change, production-flow fix, or bugfix must update the relevant checklist items in the same branch.
- If a change creates a new user-visible risk or regression path, add a manual test case and map it in the feature traceability matrix.
- Do not treat implementation as ready for handoff while this checklist is stale or missing coverage for the changed behavior.
- Unit tests, static checks, mocked browser renders, and local smoke checks do not count as completed testing for this project.
- Treat those checks as regression gates only. Report them as `unit/static checks passed`, not as `tested`.
- `Tested` means a real production/prod-like browser run against hh.ru with the extension loaded, matching the feature being changed.
- If production testing is not performed, state that explicitly and mark the relevant checklist items as `Blocked` or `Skipped` with the reason.
- Before testing, copy this file or create a separate test-run record from it.
- Fill `Test Run Metadata` and permission fields in the copy before running any checklist item.
- Only after metadata and permissions are filled, go through the checklist from top to bottom.
- Mark every relevant item as `Pass`, `Fail`, `Blocked`, `Skipped`, or `N/A`.
- Add evidence links, screenshots, logs, or exact error text for every `Fail` and `Blocked`.
- Do not run checks marked as live side effects unless explicit permission is recorded in this template.
- Keep skipped checks visible and explain why they were skipped.

## Test Run Metadata

- Test run ID:
- Tester:
- Date/time:
- Branch/commit:
- Extension version:
- Chrome version:
- Chrome profile:
- OS:
- hh.ru account type:
- hh.ru login confirmed: yes/no
- Groq key available: yes/no
- Resume URL configured: yes/no
- Live side-effect permission granted: yes/no
- Permission scope:
- Evidence folder/path:
- Related issue/PR:

## Status Legend

- `[ ]` Not run
- `[x]` Pass
- `[F]` Fail
- `[B]` Blocked
- `[S]` Skipped
- `[N/A]` Not applicable

## Source Documents

Use this template together with:

- `README.md` for install, setup, feature behavior, and safety notes.
- `ACCEPTANCE_CHECKLIST.md` for previous acceptance evidence.
- `manifest.json` for extension permissions, popup, options page, content scripts, and keyboard command.
- `src/popup.html`, `src/popup.js` for popup user actions.
- `src/options.html`, `src/options.js` for settings behavior.
- `src/background.js`, `src/content-hh.js` for runtime flows and hh.ru behavior.
- `tests/*.test.mjs` for automated regression coverage.

## Test Data And Permissions

- [ ] Tester uses a Chrome profile already signed in to hh.ru.
- [ ] Tester confirms whether live side effects are allowed before any live action:
  - submitting hh.ru applications;
  - sending resume, vacancy, question, or chat text to Groq;
  - refreshing/saving a real hh.ru resume;
  - drafting or auto-sending chat replies.
- [ ] Tester has a valid Groq API key when checking AI cover letters, employer questions, and chat replies.
- [ ] Tester has a valid hh.ru resume URL matching `https://hh.ru/resume/...`.
- [ ] Tester records Chrome profile, extension version, hh.ru account, and test timestamp in evidence.

Result:

- Status:
- Evidence:
- Notes:

## Automated Regression

Run before manual checks:

```bash
npm test
npm run test:extension
npm run test:hh:chromium
```

- [ ] Manifest is MV3, exposes popup UI, content scripts, options page, host permissions, and `Alt+Shift+A` command.
- [ ] JavaScript files parse.
- [ ] Background service worker initializes defaults and registers listeners.
- [ ] Popup controls are present and wired.
- [ ] Popup current action has no secondary detail block and does not show `Расширение выполняет задачу`.
- [ ] Popup current action text renders compactly without overflow.
- [ ] Popup exposes copy buttons for status errors and error/warning result text.
- [ ] Options page exposes current settings.
- [ ] Groq prompts include resume, vacancy, question/chat context, expected salary, and configured model.
- [ ] Auto-apply DOM tests pass for dry run, live apply, questions, skip/error handling, pagination, queue resume, stop, and Groq fallback paths.
- [ ] Auto-apply regression passes for employer-question submit that opens a vacancy detail page and must return to the original search page.
- [ ] Auto-apply regression passes for HH `Сгенерировать резюме` response dialogs.
- [ ] Auto-apply status is updated before configured delay, then updated again before the next action.
- [ ] Chat assistant tests pass for unread-only, draft-only, auto-send, external-contact reports, generated text cleanup, and bad output skip.
- [ ] Resume refresh tests pass for configured URL, edit/save/raise, captcha/login failures, and missing buttons.
- [ ] Browser UI regression test passes for blocked hh response modal continuation.
- [ ] Extension smoke loads the current extension version in Chromium.
- [ ] Authorized hh.ru Chromium smoke confirms `authenticated: true`.
- [ ] Chromium hh.ru smoke harness closes stale tabs before and after each run.

Optional live smoke test, only after explicit permission:

```bash
npm run test:hh
```

- [ ] Chrome DevTools Protocol is available at `http://127.0.0.1:9222`.
- [ ] Smoke test opens hh.ru with the loaded extension.
- [ ] Evidence is saved under `run-logs/`.

Result:

- Status:
- Evidence:
- Notes:

## Post-Install User Cases

### 1. Install Extension

- [ ] Download or clone the repository.
- [ ] Open `chrome://extensions`.
- [ ] Enable Developer mode.
- [ ] Click Load unpacked and select the folder containing `manifest.json`.
- [ ] Extension appears as `HH Job Assistant`.
- [ ] Version shown in Chrome matches `manifest.json`.
- [ ] Extension icon can be pinned.
- [ ] After file updates, Chrome Reload reloads the extension without manifest errors.

Expected result:

- [ ] Extension loads successfully.
- [ ] No install-time permission or manifest error is shown.

Result:

- Status:
- Evidence:
- Notes:

### 2. First Popup Open

- [ ] Open any non-hh.ru page and click extension icon.
- [ ] Popup shows extension version.
- [ ] Header shows `HH Job Assistant`, version, and the settings gear.
- [ ] Status shows a concrete blocker, for example `Откройте hh.ru`.
- [ ] Current action shows `Ожидание`.
- [ ] Current action text is compact and does not overflow popup width.
- [ ] Popup does not show `Расширение выполняет задачу`.
- [ ] Popup does not contain a secondary current-action detail line.
- [ ] Status and recent error/warning rows can be copied from popup using `Копировать`.
- [ ] Click `Запуск откликов`, `Поднятие резюме`, `Обработка чатов`, or `Стоп` on non-hh tab.

Expected result:

- [ ] User sees a clear message to open hh.ru first.
- [ ] Red status uses concrete blocker text, not generic `Есть ошибки`.
- [ ] No crash or stuck spinner.
- [ ] Popup remains readable without a technical-log section.

Result:

- Status:
- Evidence:
- Notes:

### 3. hh.ru Page Connection

- [ ] Open `https://hh.ru` while signed in.
- [ ] Click extension icon.
- [ ] With Groq key configured, popup shows green `ГОТОВО`.
- [ ] With Groq key configured, popup detail shows `hh.ru открыт · Groq подключен`.
- [ ] Without Groq key, popup shows yellow `ГОТОВО, без автоответов`.
- [ ] Without Groq key, popup detail shows `Вакансии с письмами/вопросами будут пропущены`.
- [ ] On logged-out hh.ru, popup shows red `Войдите в hh.ru`.
- [ ] If login or captcha appears, extension shows an error and does not continue automated actions.

Expected result:

- [ ] Extension can communicate with hh.ru content script.
- [ ] Missing Groq key is warning, not error.
- [ ] Unsafe login/captcha state stops user flows.

Result:

- Status:
- Evidence:
- Notes:

### 4. Groq Key From Settings

- [ ] Open settings through the popup gear.
- [ ] Paste Groq API key.
- [ ] Click `Сохранить`.
- [ ] Reopen settings.
- [ ] Key field is masked as `********`.
- [ ] Focus masked field.
- [ ] Field clears for replacement.
- [ ] Click `Проверить Groq`.

Expected result:

- [ ] Save reports `Ключ Groq сохранен.`.
- [ ] Test reports `Groq работает. Длина примера: ...` for valid key.
- [ ] Invalid or missing key reports a clear Groq error.
- [ ] Key is never displayed in plaintext after saving.

Result:

- Status:
- Evidence:
- Notes:

### 5. Options Page Settings

- [ ] Open popup and click the settings button.
- [ ] Options page opens.
- [ ] Check available Groq models:
  - `llama-3.3-70b-versatile`;
  - `llama-3.1-8b-instant`;
  - `openai/gpt-oss-120b`;
  - `openai/gpt-oss-20b`.
- [ ] Enter resume URL.
- [ ] Enter expected salary.
- [ ] Edit cover-letter prompt.
- [ ] Set daily apply limit.
- [ ] Set delay min and max.
- [ ] Toggle `Обрабатывать только непрочитанные чаты`.
- [ ] Switch chat reply mode between `Только черновик` and `Отправлять автоматически`.
- [ ] Set chat limit.
- [ ] Save settings.
- [ ] Reload options page.

Expected result:

- [ ] Settings persist after reload.
- [ ] Daily apply limit is clamped to `1..100`.
- [ ] Chat limit is clamped to `1..100`.
- [ ] Delay values are at least `500`.
- [ ] If max delay is lower than min delay, max is saved as min.
- [ ] Changing resume URL clears cached parsed resume text.
- [ ] Masked Groq key is preserved unless the user replaces it.

Result:

- Status:
- Evidence:
- Notes:

### 6. Developer Dry Run

- [ ] Open `https://hh.ru/search/vacancy?...`.
- [ ] Run a dry-run smoke command or send `START_DRY_RUN` from a test harness.
- [ ] Observe run state.
- [ ] Observe recent result log.

Expected result:

- [ ] Extension scans visible vacancy cards.
- [ ] It does not click response buttons.
- [ ] Found, skipped, and errors counters update.
- [ ] State becomes preview complete.
- [ ] Standalone or unrelated response buttons are ignored.

Result:

- Status:
- Evidence:
- Notes:

### 7. Auto-Apply Start Guards

- [ ] Try `Запуск откликов` from non-hh page.
- [ ] Try `Запуск откликов` from hh.ru page that is not `/search/vacancy?...`.
- [ ] Try from `https://hh.ru/search/vacancy?...`.

Expected result:

- [ ] Non-hh page is rejected with clear message.
- [ ] Wrong hh.ru page is rejected with clear message.
- [ ] Vacancy search page starts live flow only after tester intentionally clicks it.

Result:

- Status:
- Evidence:
- Notes:

### 8. Auto-Apply Basic Flow

Requires explicit permission because this can submit real applications.

- [ ] Confirm daily apply limit.
- [ ] Confirm delays.
- [ ] Confirm Groq key state.
- [ ] Click `Запуск откликов`.
- [ ] Monitor status, counters, and logs.

Expected result:

- [ ] Extension processes vacancies until successful application limit is reached, user stops, or no vacancies remain.
- [ ] Skipped vacancies do not count as successful applications.
- [ ] Delay between applications respects configured range.
- [ ] Applied, skipped, and error results are logged.
- [ ] Run ends as complete, stopped, paused, or error with clear status.

Result:

- Status:
- Evidence:
- Notes:

### 9. Auto-Apply Cover Letter

Requires explicit permission to send vacancy/resume text to Groq.

- [ ] Use a vacancy requiring a cover letter.
- [ ] Run auto-apply with Groq key configured.
- [ ] Run auto-apply without Groq key on a cover-letter vacancy.
- [ ] Simulate or observe recoverable Groq timeout/error if possible.

Expected result:

- [ ] With Groq key, generated cover letter is inserted.
- [ ] Generated text is sanitized before insertion.
- [ ] Missing Groq key skips mandatory cover-letter vacancy.
- [ ] Recoverable Groq error uses fallback cover letter where allowed.
- [ ] Non-recoverable Groq error does not silently submit bad content.

Result:

- Status:
- Evidence:
- Notes:

### 10. Employer Questions And Tests

Requires explicit permission to send question/resume/vacancy text to Groq and possibly submit applications.

- [ ] Use vacancy with text questions.
- [ ] Use vacancy with radio questions.
- [ ] Use vacancy with checkbox questions.
- [ ] Use vacancy with mixed text, radio, and checkbox questions.
- [ ] Use vacancy where no fillable fields are found.
- [ ] Use vacancy with expected salary question and no Groq key.
- [ ] Use generated answer containing markdown, prompt labels, JSON-like text, or copied prompt context.
- [ ] Use a vacancy where HH opens the vacancy detail page after question answers are submitted.
- [ ] Run that flow with the processed/application cap reached by this vacancy.

Expected result:

- [ ] Text answers are filled into textarea/input/contenteditable fields.
- [ ] Radio groups choose one matching option.
- [ ] Checkbox groups choose matching option labels.
- [ ] Bad Groq choice labels trigger retry or fallback.
- [ ] Bad generated text is skipped, not submitted.
- [ ] Expected salary fallback is used when appropriate.
- [ ] Missing fillable fields cause skip, not blind submit.
- [ ] After successful question submit opens a vacancy detail page, extension returns to the original search results page.
- [ ] When the cap is reached after that submit, the search queue is inactive and the final state is complete.
- [ ] Skipped question/response forms do not force unexpected return navigation.

Result:

- Status:
- Evidence:
- Notes:

### 11. hh.ru Response Dialog Edge Cases

- [ ] Response unavailable because resume visibility/account state blocks response.
- [ ] Already applied response form without submit button.
- [ ] Submit button missing for another reason.
- [ ] hh.ru country warning or follow-up modal appears.
- [ ] hh.ru warning says the response may be rejected and shows `Все равно откликнуться`.
- [ ] hh.ru response dialog shows `Сгенерировать резюме`.
- [ ] hh.ru keeps response dialog open after submit.
- [ ] Response page navigation times out.

Expected result:

- [ ] Blocked responses are skipped and dialog closes.
- [ ] Already confirmed responses count as applied only when confirmation is detected.
- [ ] Missing submit is skipped with clear reason.
- [ ] Country warning is confirmed when needed.
- [ ] Current action/status shows `HH предупреждает: отклик может получить отказ — подтверждаю отклик` before the confirm click.
- [ ] `Сгенерировать резюме` is treated as a valid submit/generate action, not skipped as missing submit button.
- [ ] Open dialog after submit is not counted as sent until confirmation.
- [ ] Stalled response page is recovered, skipped, and search flow resumes.

Result:

- Status:
- Evidence:
- Notes:

### 12. Pagination And Queue Resume

Requires explicit permission if live submissions continue.

- [ ] Use search results with more eligible vacancies than visible on one page.
- [ ] Start auto-apply below and above one-page capacity.
- [ ] Let flow navigate to a response form URL.
- [ ] Let flow return from detail/response page to search.
- [ ] Let HH redirect from question submit to a vacancy detail page, then verify return to search.
- [ ] Reload during queued navigation if safe to do so.

Expected result:

- [ ] Extension navigates to next search page while limit remains.
- [ ] Already processed vacancy IDs are skipped.
- [ ] Queue resumes from response form or vacancy detail page.
- [ ] Queue does not loop back to the same response form.
- [ ] Pending submit can finalize after return to search or detail confirmation page.
- [ ] Return-to-search happens before the run is considered done when HH leaves the search page.

Result:

- Status:
- Evidence:
- Notes:

### 13. Stop Flow

- [ ] Start preview or auto-apply.
- [ ] Click `Стоп`.
- [ ] Observe run panel.
- [ ] Check local logs with `npm run inspect:logs` or profile storage.
- [ ] Start a new run afterward.

Expected result:

- [ ] Active queue is cleared.
- [ ] State becomes stopped.
- [ ] `stop_run` event is recorded in local extension logs.
- [ ] New run starts from clean run results.

Result:

- Status:
- Evidence:
- Notes:

### 14. Keyboard Command

Requires explicit permission if it starts live applications.

- [ ] Open `https://hh.ru/search/vacancy?...`.
- [ ] Press `Alt+Shift+A`.
- [ ] Open popup and inspect state/logs.
- [ ] Press command on a wrong page.

Expected result:

- [ ] Command starts auto-apply only from valid vacancy search URL.
- [ ] Wrong page command is rejected and logged.

Result:

- Status:
- Evidence:
- Notes:

### 15. Resume Refresh

Requires explicit permission because it edits/saves a real resume page.

- [ ] Configure valid resume URL.
- [ ] Open hh.ru in the active tab.
- [ ] Click `Обновить резюме`.
- [ ] Observe overlay on hh.ru.
- [ ] Test when raise button is available.
- [ ] Test when raise button is unavailable but save succeeds.
- [ ] Test missing resume URL.
- [ ] Test non-hh active tab.
- [ ] Test login/captcha page.
- [ ] Test missing edit/save button if possible.

Expected result:

- [ ] Extension navigates to configured resume URL.
- [ ] Extension clicks edit and save.
- [ ] Extension raises resume when available.
- [ ] Save-only state is accepted when raise is unavailable.
- [ ] Missing URL, non-hh tab, login/captcha, missing edit, and missing save produce clear errors.

Result:

- Status:
- Evidence:
- Notes:

### 16. Chat Assistant Navigation

Requires explicit permission if it reads chats or drafts replies.

- [ ] Open popup from non-chat hh.ru page.
- [ ] Click `Обработка чатов`.
- [ ] Confirm extension opens or navigates to `https://hh.ru/chat`.
- [ ] Click `Обработка чатов` again after chat page loads.

Expected result:

- [ ] First click navigates to chat and reports that chat was opened.
- [ ] Second click starts chat processing.
- [ ] Unsafe login/captcha state stops processing.

Result:

- Status:
- Evidence:
- Notes:

### 17. Chat Assistant Filtering

Requires explicit permission to read chats.

- [ ] Enable `Process unread chats only`.
- [ ] Run chat assistant with unread and read chats visible.
- [ ] Disable `Process unread chats only`.
- [ ] Set chat limit.
- [ ] Run again.

Expected result:

- [ ] Unread-only mode skips read chats.
- [ ] Disabled unread-only mode can process visible chats up to limit.
- [ ] Found/processed counters reflect selected chats.

Result:

- Status:
- Evidence:
- Notes:

### 18. Chat Draft Mode

Requires explicit permission to send chat/resume/vacancy text to Groq.

- [ ] Set chat reply mode to `Draft only`.
- [ ] Run on a chat with an employer question.
- [ ] Inspect message input.

Expected result:

- [ ] Generated reply is inserted as a draft.
- [ ] Reply is not sent.
- [ ] Chat report status is `drafted`.
- [ ] Generated markdown or model artifacts are stripped or rejected.

Result:

- Status:
- Evidence:
- Notes:

### 19. Chat Auto-Send Mode

Requires explicit permission because it can send real chat messages.

- [ ] Set chat reply mode to `Auto-send`.
- [ ] Run on a safe test chat.
- [ ] Observe send behavior and report.

Expected result:

- [ ] Generated reply is inserted.
- [ ] Send button is clicked only after valid generated text.
- [ ] Chat report status is `sent`.
- [ ] Missing send button produces an error.

Result:

- Status:
- Evidence:
- Notes:

### 20. External Contact Chat Reports

- [ ] Use chat text that asks for phone call, Telegram, WhatsApp, email, or external link.
- [ ] Run chat assistant.
- [ ] Open popup report section.

Expected result:

- [ ] Extension does not draft or send a reply.
- [ ] Report status is `reported_external_contact`.
- [ ] Report includes chat URL and contact text.
- [ ] Contact type is classified as phone, telegram, whatsapp, email, or external link.

Result:

- Status:
- Evidence:
- Notes:

### 21. Reports And Local Logs

- [ ] Generate at least one apply result.
- [ ] Generate at least one chat report.
- [ ] Open popup.
- [ ] Inspect recent results.
- [ ] Inspect chat reports.
- [ ] Inspect local extension logs via `npm run inspect:logs` or profile storage.
- [ ] Click `Очистить` for chat reports.

Expected result:

- [ ] Recent results show applied/skipped/error messages.
- [ ] Chat report section shows latest reports with direct chat links.
- [ ] Local logs include `agentDebugLogFile`, `agentDebugLogText`, `runState`, and recent events.
- [ ] Chat report clear button clears only chat reports.
- [ ] Popup refreshes without reload.

Result:

- Status:
- Evidence:
- Notes:

### 22. Safety And Error States

- [ ] Login page appears.
- [ ] Captcha or anti-bot page appears.
- [ ] Groq key is missing.
- [ ] Groq returns HTTP error.
- [ ] Groq times out.
- [ ] Extension context is invalidated by reload.
- [ ] hh.ru markup changes and selector is missing.

Expected result:

- [ ] Login/captcha/anti-bot stops run with clear error.
- [ ] Missing Groq key skips AI-required work or uses non-AI fallback only where designed.
- [ ] Groq HTTP error is visible and logged.
- [ ] Recoverable Groq timeout can use fallback where allowed.
- [ ] Extension context invalidation does not crash content script.
- [ ] Missing selector becomes skip/error with evidence, not silent success.

Result:

- Status:
- Evidence:
- Notes:

## Feature Traceability Matrix

| Feature | User path | Main checks | Automated coverage |
| --- | --- | --- | --- |
| Install/load extension | Chrome Load unpacked | Manifest, permissions, popup/options/content scripts | `extension-build.test.mjs` |
| Popup health | Open popup on hh.ru and non-hh page | Extension ready, tab status, version | `extension-build.test.mjs` |
| Popup current action/copy | Open popup during active run or error | Compact current action, no secondary detail text, copyable status/errors | `extension-build.test.mjs` |
| Options settings | Open settings, save/reload | Model, resume URL, salary, prompt, limits, delays, chat settings | `extension-build.test.mjs` |
| Auto-apply | `Запуск откликов` | Limit, delays, submit confirmation, status-before-delay, logs | `content-auto-apply.test.mjs`, `hh-ui-flow.test.mjs` |
| Employer questions | Auto-apply on test forms | Text/radio/checkbox, salary fallback, bad output skip, return to search after HH opens vacancy detail | `content-auto-apply.test.mjs` |
| HH generated resume response | Auto-apply on HH response modal | `Сгенерировать резюме` button is clicked and confirmed | `content-auto-apply.test.mjs` |
| Stop | `Стоп` | Queue cleared, stopped state, local log event | `content-auto-apply.test.mjs` |
| Keyboard command | `Alt+Shift+A` | Valid URL guard, start auto-apply | `extension-build.test.mjs` |
| Resume refresh | `Обновить резюме` | Configured URL, edit/save/raise, error states | `resume-refresh.test.mjs` |
| Chat navigation | `Обработка чатов` | Open `/chat`, rerun after load | `content-chat-assist.test.mjs` |
| Chat draft | Draft mode | Fill input, do not send, report | `content-chat-assist.test.mjs` |
| Chat auto-send | Auto-send mode | Click send only after valid draft | `content-chat-assist.test.mjs` |
| External contact reports | Chat asks for phone/messenger/email/link | Report and skip reply | `content-chat-assist.test.mjs` |
| Reports/logs | Popup plus local storage | Recent results, chat reports, local debug artifact | `extension-build.test.mjs` |
| Safety errors | Login/captcha/Groq/selector failures | Stop/skip/error with evidence | `content-auto-apply.test.mjs`, `resume-refresh.test.mjs` |

## Test Case Result Template

For each manual run, capture:

- Test case:
- Status:
- Date/time:
- Preconditions:
- Steps executed:
- Expected result:
- Actual result:
- Evidence path or screenshot:
- Logs/errors:
- Bugs found:
- Follow-up owner:

## Bug Report Template

- Bug ID:
- Title:
- Severity:
- Environment:
- Preconditions:
- Steps to reproduce:
- Expected result:
- Actual result:
- Evidence:
- Regression: yes/no/unknown
- Suspected area:
- Workaround:
- Owner:
- Status:
