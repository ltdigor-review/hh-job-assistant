#!/usr/bin/env bash
set -euo pipefail

log_file="${HHJA_TEST_LOG:-/tmp/hhja-test-summary-$$.log}"
tail_lines="${HHJA_TEST_TAIL:-80}"

echo "Running npm test. Full log: ${log_file}"

set +e
npm test >"${log_file}" 2>&1
status=$?
set -e

if [[ "${status}" -eq 0 ]] && grep -Eq '(^|[[:space:]#])(fail|cancelled)[[:space:]]+[1-9][0-9]*' "${log_file}"; then
  status=1
fi

echo
if [[ "${status}" -eq 0 ]]; then
  echo "npm test: PASS"
else
  echo "npm test: FAIL (${status})"
fi

echo
echo "Last ${tail_lines} log lines:"
tail -n "${tail_lines}" "${log_file}" || true

exit "${status}"
