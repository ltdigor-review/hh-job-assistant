# HH Job Assistant Business Specification

This file is the canonical business-level source of truth for the extension. Product code, user interfaces, and tests must conform to the active rules below.

## Contract

- Only JSON inside `BUSINESS_SPEC_RULE_BEGIN` / `BUSINESS_SPEC_RULE_END` blocks is normative.
- A committed rule block is immutable: do not edit, delete, reorder, or reformat it.
- New behavior is introduced by appending the next sequential rule at the end of this file.
- Changed behavior is introduced by appending a rule whose `supersedes` array names the active rule or rules it replaces. Historical rules remain in place.
- When rules conflict, the newest active rule reached through an explicit `supersedes` relationship governs.
- Every active rule must be linked to at least one passing executable test by a literal `[BS:COVERS:<rule-id>]` marker in the test title.
- Every supersession edge must be linked to a passing transition test by `[BS:RETIRES:<old-id>:BY:<new-id>]`.
- `BUSINESS_SPEC.lock.jsonl` locks the exact bytes and canonical content of every rule in order. `npm run spec:lock` may only append lock entries for new end-of-file rules and compares the current prefix with every reachable Git version of the contract.
- `npm run spec:check` validates rule structure, Git history, the append-only lock, supersession history, and static test coverage. `npm test` additionally requires every coverage marker to appear in a structured passing Node test event; printed TAP-like text cannot satisfy coverage.
- Hashes and reachable Git history prevent accidental or ordinary committed history edits. Repository review and branch protection must still reject a coordinated Git history rewrite that removes the original commits.

## Initial business rules

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000001",
  "scope": "configuration",
  "requirement": "The extension MUST initialize missing settings from one shared defaults registry and migrate existing installations without erasing saved credentials, provider choices, or non-empty custom prompts.",
  "acceptance": [
    "AI defaults to enabled with Qwen as primary and no fallback provider.",
    "The default application limit is 200, delays are 4000–8000 ms, resume-profile auto-refresh is enabled, and diagnostic history defaults are defined centrally.",
    "The editable fallback cover-letter template defaults to «Откликаюсь на вакансию. Подробности опыта указаны в резюме.».",
    "Existing provider keys, provider selections, and non-empty custom prompts survive migration."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000002",
  "scope": "configuration",
  "requirement": "When AI is enabled, launch readiness MUST require a valid HH resume URL and a saved key for the selected primary provider.",
  "acceptance": [
    "The resume URL is HTTPS, belongs to an HH domain, and has a /resume/<id> path.",
    "A missing or whitespace-only selected-provider key makes Start and Continue unavailable.",
    "Internal prompt fields are not launch blockers."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000003",
  "scope": "configuration",
  "requirement": "When AI is explicitly disabled, launch readiness MUST require only a valid HH resume URL and MUST NOT infer the mode from missing provider keys.",
  "acceptance": [
    "The popup reports the intentional no-AI mode as ready when the resume URL is valid.",
    "Start and Continue remain available without Qwen or Groq keys.",
    "Saved keys and provider selections remain stored for later re-enabling."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000004",
  "scope": "configuration",
  "requirement": "Provider credentials MUST be registry-driven, independently manageable, masked after saving, and never exposed in status text or logs.",
  "acceptance": [
    "Editing or testing one provider does not overwrite another provider's saved key.",
    "An unchanged masked field preserves its saved credential.",
    "Deleting a credential removes only that provider and disables a fallback that can no longer run.",
    "Legacy Groq key storage is migrated into the provider credential registry."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000005",
  "scope": "configuration",
  "requirement": "Saved automation controls MUST be normalized to supported bounds before runtime use.",
  "acceptance": [
    "Daily application limit is between 1 and 200.",
    "Minimum and maximum delays are at least 500 ms and maximum delay is not below minimum delay.",
    "Resume cache TTL is between 0.1 and 168 hours and debug retention is between 1 and 20 runs.",
    "Employment preferences contain only ИП or ТК, and work-format preferences contain only remote, hybrid, or office."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000006",
  "scope": "ai-routing",
  "requirement": "AI requests MUST use the task capabilities and fixed routing declared in the provider registry.",
  "acceptance": [
    "Qwen uses qwen3.8-max-preview with thinking enabled for supported AI tasks.",
    "Groq uses llama-3.1-8b-instant for cover letters and openai/gpt-oss-120b for structured questions and resume profiles.",
    "Structured tasks request the provider's declared JSON response format and token cap.",
    "Payloads contain bounded resume/profile, vacancy, question, salary, contact, and preference context."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000007",
  "scope": "ai-routing",
  "requirement": "A provider test MUST exercise only the provider and draft credential selected by the user.",
  "acceptance": [
    "An explicitly empty draft does not silently reuse a stored credential.",
    "Provider testing does not invoke a fallback provider.",
    "Testing a draft does not save it unless the user separately saves the credential."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000008",
  "scope": "ai-routing",
  "requirement": "Cross-provider fallback MUST run at most once and only through the explicitly selected, credentialed alternate provider for an eligible primary-provider failure.",
  "acceptance": [
    "No fallback runs when it is disabled, lacks a key, equals the primary provider, or does not support the task.",
    "Resume validation and other local precondition failures do not trigger fallback.",
    "The original primary provider remains selected after a fallback attempt."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000009",
  "scope": "ai-runtime",
  "requirement": "AI quota, cooldown, timeout, and response failures MUST be bounded and classified without exposing credentials.",
  "acceptance": [
    "HTTP 429 is reported as quota or rate limiting, never as an invalid key, and stores an applicable cooldown.",
    "Quota accounting includes cached tokens and resets on a new UTC day.",
    "Only short token-per-minute reset waits occur automatically.",
    "Empty, malformed, truncated, or rejected output produces a typed task failure."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000010",
  "scope": "no-ai",
  "requirement": "Explicit no-AI mode MUST prevent every background AI command and provider network request.",
  "acceptance": [
    "Cover-letter, employer-question, provider-test, resume-profile build, resume-profile edit, and automatic profile-update commands fail before network access.",
    "Blocked background commands return code HHJA_AI_DISABLED.",
    "Ordinary HH resume raising remains available because it is not an AI function."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000011",
  "scope": "resume-context",
  "requirement": "Resume context MUST come from the configured HH resume URL and be bounded, cached by URL and TTL, and invalidated when its source changes.",
  "acceptance": [
    "The configured resume is parsed in a temporary inactive tab and that tab is closed after parsing.",
    "A fresh cache for the same URL may be reused.",
    "A stale cache or changed URL is rebuilt without mutating the original parsed resume text while building a compact brief.",
    "Large resume components are capped before provider submission."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000012",
  "scope": "resume-context",
  "requirement": "Exact candidate facts MUST come from exact resume signals and MUST NOT be invented from unrelated context.",
  "acceptance": [
    "An actual age question is skipped when exact age is unavailable.",
    "Missing exact age does not block an unrelated employer question or ordinary profile refresh.",
    "Exact salary and contact values remain bound to configured or parsed resume facts."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000013",
  "scope": "resume-profile",
  "requirement": "Resume-profile build and edit MUST produce factual bounded profile data and preserve the complete last-good profile on failure.",
  "acceptance": [
    "Build requires enabled AI and readable resume context.",
    "Edit requires an existing profile and a non-empty user instruction.",
    "Empty or length-truncated output may retry once with the declared larger cap; HTTP failures are not retried.",
    "Invalid final output preserves profile text, weaknesses, source hash, build time, check time, and audit metadata."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000014",
  "scope": "resume-profile",
  "requirement": "Automatic resume-profile refresh MUST be single-flight, TTL/hash-driven, and run before a batch rather than once per vacancy.",
  "acceptance": [
    "No automatic profile refresh runs while AI is disabled.",
    "A failed refresh preserves the current profile.",
    "A parsed exact resume salary may align the configured expected salary.",
    "Automation settings audit distinguishes an intentionally disabled AI mode from an enabled provider missing its key."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000015",
  "scope": "resume-refresh",
  "requirement": "Manual resume refresh MUST use the active HH tab, navigate to the configured resume, save an unchanged edit, and raise the resume when that action is available.",
  "acceptance": [
    "Edit occurs before the raise attempt.",
    "A successful save is sufficient when HH does not offer a raise control.",
    "The flow may continue after the resume DOM is ready even if the tab status remains loading."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000016",
  "scope": "resume-refresh",
  "requirement": "Manual resume refresh MUST fail closed before unsafe navigation and stop on authentication, CAPTCHA, or missing required HH controls.",
  "acceptance": [
    "A non-HH active tab or missing configured resume URL fails before navigation.",
    "Login and CAPTCHA pages stop the operation.",
    "Missing edit or save controls return concrete failures rather than reporting success."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000017",
  "scope": "auto-apply",
  "requirement": "Live Start and Continue MUST pass readiness and authenticated safe-HH-page guards before mutating run state, queues, or visible results.",
  "acceptance": [
    "Accepted entry pages are an HH vacancy search with query parameters or a matching HH response flow.",
    "Login, signup, CAPTCHA, anti-bot, or unsafe pages stop before vacancy processing.",
    "Failed readiness reports ordered blockers and leaves runtime state unchanged."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000018",
  "scope": "auto-apply",
  "requirement": "Dry run MUST require HH authentication, scan only scoped vacancy cards, and never click a response or submit control.",
  "acceptance": [
    "Broad unrelated response controls outside vacancy cards are ignored.",
    "Dry run produces preview counters and results without creating applications.",
    "Authentication failure stops before scanning."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000019",
  "scope": "auto-apply",
  "requirement": "Start and Continue MUST be single-flight, and the trusted page shortcut MUST reject synthetic or repeated input.",
  "acceptance": [
    "The shortcut requires a real non-repeating Alt+Shift+A event without Ctrl or Meta.",
    "A duplicate start or already-active queue does not create a second run.",
    "A resumable saved queue is continued instead of starting an unrelated run."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000020",
  "scope": "auto-apply",
  "requirement": "Auto-apply MUST process vacancies from the user's current HH query sequentially without hidden profession, title, salary, or resume-match filtering.",
  "acceptance": [
    "The configured limit targets confirmed new applications, not processed or skipped cards.",
    "Heterogeneous completable vacancies may be processed up to the supported limit of 200.",
    "An optional bounded maxProcessed smoke-test cap remains separate from the successful-application limit."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000021",
  "scope": "auto-apply",
  "requirement": "Response and search queues MUST preserve run identity, counters, configuration, source search URL, pending submission, and processed vacancy IDs across HH navigation.",
  "acceptance": [
    "Queued response, vacancy detail, search, pagination, redirect, and reload transitions resume the same run.",
    "Previously processed vacancy IDs are skipped.",
    "Next search page is opened only while quota remains.",
    "A non-matching vacancy tab cannot consume another queued vacancy."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000022",
  "scope": "auto-apply",
  "requirement": "Stop MUST interrupt further waits, AI handling, filling, and submission, clear active queues and pending submission, and leave an explicit stopped state.",
  "acceptance": [
    "Stop is durable across extension contexts and is checked before each consequential action.",
    "Stop closes an active response dialog when possible and records a stop diagnostic event.",
    "Continue is available only when a valid saved queue exists; otherwise it reports that no queue can be resumed."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000023",
  "scope": "auto-apply",
  "requirement": "Diagnostic stop-before-submit MUST be run-scoped, preserve generated form content, and prevent the submit action.",
  "acceptance": [
    "The guard belongs to one run, expires after its bounded lifetime, and is cleared at terminal state.",
    "Legacy or stale markers do not stop a new live run.",
    "Dry run does not consume a pending live-run guard."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000024",
  "scope": "navigation",
  "requirement": "Programmatic navigation and pending-submit recovery MUST remain on HTTPS HH domains and match the active vacancy before finalizing a result.",
  "acceptance": [
    "Content navigation is delegated to the background tab update guard.",
    "Signup or non-HH redirects stop rather than continue an application.",
    "A pending submission is finalized only from matching HH confirmation, search, or vacancy-detail state.",
    "Recovery does not loop back to the same response form."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000025",
  "scope": "response-form",
  "requirement": "Response detection and filling MUST be scoped to the active current-vacancy response surface.",
  "acceptance": [
    "Global already-applied text and recommendation-card response controls do not determine the current vacancy state.",
    "An active current-vacancy response control overrides stale already-applied copy.",
    "The HH attach-cover-letter modal is classified as a cover-letter form, not as employer questions."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000026",
  "scope": "response-form",
  "requirement": "A vacancy with no cover-letter field and no employer questions MUST follow the ordinary HH response flow without an AI request.",
  "acceptance": [
    "The response is submitted when HH offers a valid ordinary response action.",
    "Successful counting still requires current-vacancy HH confirmation.",
    "No-AI mode does not prevent this ordinary response."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000027",
  "scope": "cover-letter",
  "requirement": "A cover letter MUST be final compact text, and invalid or unavailable AI output MUST fall back to the editable local template before filling.",
  "acceptance": [
    "Accepted generated text is at most 220 characters and two sentences.",
    "Markdown, protocol labels, JSON, prompt leakage, copied context, refusal text, and configured cliché patterns are rejected.",
    "Provider timeout, provider error, rejected output, or missing eligible fallback uses the saved local template.",
    "The filled value is verified before submission."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000028",
  "scope": "no-ai",
  "requirement": "In no-AI mode, a cover-only form MUST use the editable local template, while any vacancy containing an employer question MUST be skipped without filling or submission.",
  "acceptance": [
    "Text questions, deterministic salary questions, radio groups, checkbox groups, and mixed forms all cause the whole vacancy to be skipped.",
    "The result reason is skipped_ai_disabled_questions.",
    "No field is filled and no provider request occurs for a skipped question form.",
    "A cover-only form continues after its template is filled."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000029",
  "scope": "employer-questions",
  "requirement": "Employer-question handling MUST support textareas, text inputs, contenteditable fields, radio groups, and checkbox groups and verify the final DOM state before submission.",
  "acceptance": [
    "Required values and selected options are re-read after filling.",
    "Missing fields, blocked response, missing submit, HH validation, or unverifiable fill causes a safe skip or error rather than blind submission.",
    "The question form is processed only inside the active response surface."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000030",
  "scope": "employer-questions",
  "requirement": "Non-deterministic employer questions and an optional mandatory cover letter MUST be sent in one structured AI request whose response is bound by stable question IDs.",
  "acceptance": [
    "Response IDs are complete, unique, known, and mapped to the matching field.",
    "A raw response or answer for one question is never pasted into another question.",
    "A mandatory cover letter is separated from the answer protocol before filling."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000031",
  "scope": "employer-questions",
  "requirement": "Salary, contact, exact age, employment type, and work-format answers MUST be filled deterministically from configured or exact resume facts whenever possible.",
  "acceptance": [
    "Deterministic answers do not create a provider request.",
    "Expected salary is used only for an actual salary question.",
    "Configured contact policy overrides a model-proposed contact.",
    "Missing exact required facts such as actual age cause a safe skip rather than invention."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000032",
  "scope": "employer-questions",
  "requirement": "Choice answers MUST use exact current HH labels, and dynamic forms MUST be re-snapshotted by stable IDs after rerender.",
  "acceptance": [
    "Raw values such as on, true, short, or the question label are not sent as answer options.",
    "Unknown or guessed choices are skipped rather than submitted.",
    "Only controls and option labels from the current form snapshot may be selected.",
    "Conditional-form re-snapshotting stops after three changes."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000033",
  "scope": "employer-questions",
  "requirement": "Generated employer answers MUST be sanitized and rejected when they are unsafe, structurally invalid, or unsupported by candidate facts.",
  "acceptance": [
    "Markdown, protocol labels, JSON, refusal or filler text, prompt leakage, and semantic garbage are rejected.",
    "Missing, unknown, or duplicate structured IDs reject the response.",
    "The extension does not invent a free-text answer when all eligible providers fail.",
    "Sanitization may remove formatting but may not manufacture a missing factual answer."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000034",
  "scope": "application-counting",
  "requirement": "The applied counter and daily ledger MUST contain only confirmed new submissions for the current Europe/Moscow date, deduplicated by vacancy ID.",
  "acceptance": [
    "A submit click without HH confirmation does not increment applied or consume the successful-application limit.",
    "Already-applied vacancies are recorded separately and consume no new-submit quota.",
    "The ledger resumes across runs on the same Moscow date.",
    "Skipped cards, provider failures, and form errors do not increment applied."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000035",
  "scope": "hh-interruptions",
  "requirement": "HH daily limits and fatal authentication or anti-bot states MUST stop the run, while recoverable vacancy-specific failures MUST remain isolated to that vacancy.",
  "acceptance": [
    "An HH daily-response-limit signal clears queues and pending submission and completes without a new application count.",
    "Login, signup, CAPTCHA, anti-bot, or excessive-request state is fatal for the run.",
    "A blocked response dialog, unsupported form, provider failure, or unsafe answer may be recorded and processing may continue when authentication remains valid.",
    "Supported HH country-warning confirmation is surfaced and handled before continuing."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000036",
  "scope": "popup",
  "requirement": "The popup MUST expose localized readiness, current action, counters, recent results, version, and action availability without exposing technical logs.",
  "acceptance": [
    "Intentional no-AI mode is shown as «ГОТОВО, ИИ выключен» rather than «НЕ НАСТРОЕНО».",
    "Enabled AI with a missing selected-provider key remains not configured.",
    "Start and Continue are disabled during active work; Stop is enabled only during active work.",
    "Continue is offered only for a resumable queue, and disabled actions expose a concrete reason.",
    "Raw browser and network errors are localized before display."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000037",
  "scope": "settings-ui",
  "requirement": "Settings MUST expose the complete saved business configuration and keep credential management available while disabling AI-dependent controls in no-AI mode.",
  "acceptance": [
    "The UI exposes Use AI, primary provider, eligible fallback, provider credentials, fallback template, resume/profile controls, prompts, automation limits, preferences, and diagnostics.",
    "The fallback block is hidden when AI is disabled or no eligible configured alternate provider exists.",
    "Provider routing, provider test, profile build/edit, and other AI actions are disabled when AI is off.",
    "Local credential save and delete remain available, and turning AI back on restores prior provider selections and keys.",
    "The no-AI rules for cover letters and employer questions are stated next to the mode control."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000038",
  "scope": "diagnostics",
  "requirement": "Diagnostic history MUST be local, gated by the saved Logs setting at run start, bounded by retention, and downloadable one selected run at a time.",
  "acceptance": [
    "Logging must be enabled before a run starts; enabling it mid-run does not create a partial run.",
    "Only the newest configured number of runs are retained and each run has a bounded entry count.",
    "Disabling logs clears retained run history and legacy raw log keys.",
    "A downloaded .debug artifact is newline-delimited JSON with run identity, version, status, and incomplete or truncation metadata."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000039",
  "scope": "diagnostics",
  "requirement": "Public diagnostic storage and exports MUST redact secrets and personal application text, while any raw private form audit remains separate and local.",
  "acceptance": [
    "Keys, tokens, authorization data, resume/profile text, salary, contacts, vacancy titles, questions, answers, prompts, and URL query or fragment are absent from public logs.",
    "Safe identifiers, provider/model names, counts, hashes, lengths, and URL origin/path may remain.",
    "Private question, answer, cover-letter, and URL evidence is never mixed into the public report.",
    "Diagnostic logging failure does not break the application workflow."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000040",
  "scope": "diagnostics",
  "requirement": "The log inspector and automation settings audit MUST distinguish exact current evidence from incomplete, malformed, or intentionally disabled states.",
  "acceptance": [
    "Malformed NDJSON reports its line and completed evidence with missing identity or result counts fails closed.",
    "Incomplete LevelDB snapshots are retried and then rejected; a complete exact snapshot may report retained-history truncation.",
    "Private audit output is explicit, separate, and protected with restrictive file permissions.",
    "Settings audit treats intentional no-AI mode as not requiring provider/profile AI checks while enabled AI without a selected-provider key remains an issue."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000041",
  "scope": "platform-safety",
  "requirement": "The distributed extension MUST remain a version-synchronized Manifest V3 extension with Russian user-facing text and least-privilege HH and provider access.",
  "acceptance": [
    "Manifest, package, and visible version sources agree.",
    "Programmatic page navigation is restricted to HTTPS HH domains.",
    "Provider network access is limited to declared Qwen and Groq endpoints.",
    "Debug export requires no broad download or offscreen permission.",
    "User-facing extension errors and controls are localized in Russian."
  ],
  "supersedes": [],
  "introduced": "2026-07-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000042",
  "scope": "ai-routing",
  "requirement": "AI requests MUST use currently supported stable task models and the fixed routing declared in the provider registry.",
  "acceptance": [
    "Qwen uses qwen3.8-max with thinking enabled for supported AI tasks.",
    "Groq uses openai/gpt-oss-20b with low reasoning effort for cover letters and openai/gpt-oss-120b for structured questions and resume profiles.",
    "Structured tasks request the provider's declared JSON response format and token cap.",
    "Payloads contain bounded resume/profile, vacancy, question, salary, contact, and preference context."
  ],
  "supersedes": ["HHJA-BR-000006"],
  "introduced": "2026-08-28"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000043",
  "scope": "ai-failure-safety",
  "requirement": "Enabled AI MUST stop the entire auto-apply run without submission after eligible provider fallback is exhausted or generated output is unsafe.",
  "acceptance": [
    "Generated cover letters remain final Russian compact text, at most 220 characters and two sentences, with no protocol, prompt/context leakage, refusals, or configured clichés.",
    "Only explicit no-AI mode uses the saved local cover template; enabled-AI errors never substitute local answers or template letters.",
    "Provider and profile failures retain typed cause and HTTP status; both queues stop and late results cannot cause submission or a move to the next vacancy.",
    "HH daily response limits clear queues and pending submission without counting a new application; authentication, CAPTCHA, anti-bot and excessive-request states remain fatal.",
    "Blocked dialogs and unsupported vacancy-specific forms may still be skipped; supported HH country warnings remain handled before continuing."
  ],
  "supersedes": [
    "HHJA-BR-000027",
    "HHJA-BR-000035"
  ],
  "introduced": "2026-09-22"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000044",
  "scope": "ai-routing",
  "requirement": "A provider diagnostic MUST verify cover and structured task capabilities using synthetic inputs and only the selected provider and draft credential.",
  "acceptance": [
    "Groq checks GPT-OSS 20B cover output and GPT-OSS 120B structured profile and employer-answer output; Qwen checks its declared capabilities.",
    "Partial model or task failure is reported as such, not as general provider readiness.",
    "An explicitly empty credential does not reuse the saved key; testing does not save a draft or invoke provider fallback.",
    "Provider diagnostics do not read or transmit the user resume."
  ],
  "supersedes": [
    "HHJA-BR-000007"
  ],
  "introduced": "2026-09-22"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000045",
  "scope": "settings-ui",
  "requirement": "Popup and Settings MUST share an immediately persisted Use AI switch and prevent mode changes during active runs.",
  "acceptance": [
    "The switch uses existing aiEnabled storage, preserves keys, provider selections and custom text, and synchronizes between open views without erasing unrelated drafts.",
    "An active run or run lease rejects a mode change; terminal or idle state permits it.",
    "A changed mode invalidates resumable queues of the old mode, preserves result history, and requires a new start.",
    "No-AI mode uses the saved cover text without AI requests or profile/key requirements and skips all employer questionnaires.",
    "Existing default enabled state is preserved for new installations."
  ],
  "supersedes": [],
  "introduced": "2026-09-22"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000046",
  "scope": "ai-runtime",
  "requirement": "Provider operations MUST enforce a bounded full-response and queue deadline, route quota failures through configured fallback, and preserve trustworthy diagnostics.",
  "acceptance": [
    "Timeouts cover response headers and body; body read failures remain typed and release queued work.",
    "Background and content derive task deadlines from selected providers, attempts and permitted quota waits; expired queued work cannot issue late requests.",
    "Local Groq quota failures are eligible for the configured credentialed alternate provider, with no fallback when disabled.",
    "Failed HTTP responses without usage do not incur estimated generated tokens; rate-limit headers and cooldown remain observed.",
    "Provider, task, HTTP status and typed error code survive sanitized diagnostics without keys or private request/response text."
  ],
  "supersedes": [],
  "introduced": "2026-09-22"
}
```
<!-- BUSINESS_SPEC_RULE_END -->

<!-- BUSINESS_SPEC_RULE_BEGIN -->
```json
{
  "schema": 1,
  "kind": "business-rule",
  "id": "HHJA-BR-000047",
  "scope": "employer-questions",
  "requirement": "Question autofill MUST reconcile exact checkbox selections and validate connected current form fields after rerenders before submission.",
  "acceptance": [
    "Undesired preselected checkboxes are cleared and desired selections remain checked.",
    "Equivalent rerenders rebind current fields and reuse answers; changed question schemas regenerate only within the bounded resnapshot limit.",
    "Synchronous and delayed rerenders cannot cause detached-node values to pass final fill verification.",
    "An unstable or unverifiable form is never submitted."
  ],
  "supersedes": [],
  "introduced": "2026-09-22"
}
```
<!-- BUSINESS_SPEC_RULE_END -->
