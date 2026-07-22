#!/usr/bin/env bash

set -euo pipefail

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
environment_file="$repository_root/.env"

fail() {
	echo "$1" >&2
	exit 1
}

[[ -f "$environment_file" ]] || fail "Missing $environment_file"
[[ -r "$repository_root/.output/server/index.mjs" ]] ||
	fail "Missing production build; run pnpm build"
[[ -d "$repository_root/data" ]] || fail "Missing $repository_root/data"

environment_mode=$(stat -c "%a" "$environment_file")
[[ "$environment_mode" == "600" ]] ||
	fail "$environment_file must have mode 600, found $environment_mode"

grep -Eq '^APP_ORIGIN=https://[^[:space:]]+$' "$environment_file" ||
	fail "APP_ORIGIN must be an HTTPS origin"

if grep -q '^ACCOUNT_BOOTSTRAP_TOKEN=' "$environment_file"; then
	fail "Remove ACCOUNT_BOOTSTRAP_TOKEN after confirming the administrator exists"
fi

