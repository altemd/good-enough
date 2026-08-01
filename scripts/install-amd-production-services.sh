#!/usr/bin/env bash

set -euo pipefail

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
source_directory="$repository_root/deploy/systemd/user"
configuration_root=${XDG_CONFIG_HOME:-"$HOME/.config"}
unit_directory="$configuration_root/systemd/user"

for command in install systemctl systemd-analyze; do
	if ! command -v "$command" >/dev/null 2>&1; then
		echo "Required command not found: $command" >&2
		exit 1
	fi
done

"$repository_root/scripts/check-amd-production.sh"
systemd-analyze --user verify \
	"$source_directory/good-enough-app.service" \
	"$source_directory/good-enough-llama.service" \
	"$source_directory/good-enough-ds4.service" \
	"$source_directory/good-enough.target" \
	"$source_directory/good-enough-ds4.target"

install -d -m 700 "$unit_directory"
install -m 644 \
	"$source_directory/good-enough-app.service" \
	"$source_directory/good-enough-llama.service" \
	"$source_directory/good-enough-ds4.service" \
	"$source_directory/good-enough.target" \
	"$source_directory/good-enough-ds4.target" \
	"$unit_directory/"

systemctl --user daemon-reload
systemctl --user enable good-enough.target

echo "Production units are installed but not started."
echo "Enable lingering once with: sudo loginctl enable-linger $USER"
echo "Start after stopping development: pnpm prod:amd:start"
echo "The alternative ds4 target is installed but not enabled: pnpm prod:amd:ds4:start"
