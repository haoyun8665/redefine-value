#!/bin/bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
if [[ "$#" -gt 1 || ( "$#" -eq 1 && "$1" != "--web-only" ) ]]; then
  echo 'Usage: ./scripts/test.sh [--web-only]' >&2
  exit 2
fi
TZ=Asia/Shanghai node --test tests/*.test.cjs
if [[ "$#" -eq 1 ]]; then exit 0; fi
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Native tests require macOS; use --web-only on other platforms.' >&2
  exit 1
fi
mkdir -p .build
task_temporary="$(mktemp -d "$task_root/.build/tests.XXXXXX")"
trap 'rm -rf "$task_temporary"' EXIT
task_sources=(Native.swift Integration.swift FinanceVault.swift)
task_frameworks=(-framework AppKit -framework WebKit -framework Security -framework CryptoKit -framework Network -framework UserNotifications)
for task_suite in IntegrationTests MockTests FinanceVaultTests; do
  echo "Running $task_suite"
  swiftc -parse-as-library -D TESTING -swift-version 5 "${task_sources[@]}" "tests/$task_suite.swift" -o "$task_temporary/$task_suite" "${task_frameworks[@]}"
  "$task_temporary/$task_suite"
done
