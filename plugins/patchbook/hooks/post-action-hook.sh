#!/bin/bash

# Post-action hook for patchbook
# Generates the dashboard from real .patchbook/ data after mutations

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
USER_PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-${PWD}}"

if [ -z "${PATCHBOOK_ROOT:-}" ]; then
  PATCHBOOK_DATA_ROOT="${USER_PROJECT_ROOT}/.patchbook"
elif [[ "${PATCHBOOK_ROOT}" = /* ]]; then
  PATCHBOOK_DATA_ROOT="${PATCHBOOK_ROOT}"
else
  PATCHBOOK_DATA_ROOT="${USER_PROJECT_ROOT}/${PATCHBOOK_ROOT}"
fi

# Build the project to ensure dist/ is up-to-date
npm run build --prefix "${PLUGIN_ROOT}" >/dev/null 2>&1 || true

# Generate the dashboard from real project .patchbook/ data into the data directory, not the package
mkdir -p "${PATCHBOOK_DATA_ROOT}"
export PATCHBOOK_PLUGIN_ROOT="${PLUGIN_ROOT}"
export PATCHBOOK_ROOT="${PATCHBOOK_DATA_ROOT}"
export PATCHBOOK_DASHBOARD_PATH="${PATCHBOOK_DATA_ROOT}/dashboard.html"

node <<'NODE'
const path = require('path');

try {
  const { saveDashboard } = require(path.join(
    process.env.PATCHBOOK_PLUGIN_ROOT,
    'dist/patchbook/generate-dashboard'
  ));
  const output = saveDashboard(process.env.PATCHBOOK_DASHBOARD_PATH);
  console.log('Dashboard generated at:', output);
} catch (err) {
  console.error('Dashboard generation failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
NODE
