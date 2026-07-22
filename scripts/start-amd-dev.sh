#!/usr/bin/env bash

set -Eeuo pipefail

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
model_root=${GOOD_ENOUGH_MODEL_ROOT:-/mnt/bridge}
toolbox_container=${GOOD_ENOUGH_LLAMA_TOOLBOX:-llama-rocm-7.2.4}
app_session=good-enough-app
llama_session=good-enough-llama
started_sessions=()

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		fail "Required command not found: $1"
	fi
}

fail() {
	echo "$1" >&2
	return 1
}

session_exists() {
	tmux has-session -t "$1" 2>/dev/null
}

url_is_ready() {
	curl --connect-timeout 1 --max-time 2 --fail --silent --output /dev/null "$1"
}

port_is_listening() {
	[[ -n $(ss --no-header --listening --tcp --numeric "sport = :$1") ]]
}

wait_for_url() {
	local label=$1
	local url=$2

	for _attempt in {1..30}; do
		if url_is_ready "$url"; then
			echo "$label is ready at $url"
			return 0
		fi
		sleep 1
	done

	echo "$label did not become ready at $url" >&2
	return 1
}

cleanup_started_sessions() {
	local exit_status=$?
	trap - ERR INT TERM

	if ((${#started_sessions[@]} > 0)); then
		for session in "${started_sessions[@]}"; do
			if session_exists "$session"; then
				echo "Stopping $session after startup failure" >&2
				tmux kill-session -t "$session"
			fi
		done
	fi

	exit "$exit_status"
}

trap cleanup_started_sessions ERR INT TERM

require_command curl
require_command pnpm
require_command ss
require_command tmux
require_command toolbox

if [[ ! -f "$repository_root/.env" ]]; then
	fail "Missing $repository_root/.env"
fi

if [[ ! -r "$model_root/models/config.ini" ]]; then
	fail "Missing readable llama-server preset: $model_root/models/config.ini"
fi

if session_exists "$llama_session"; then
	echo "$llama_session is already running"
elif port_is_listening 8080; then
	fail "Port 8080 is already owned outside $llama_session"
else
	printf -v llama_command \
		'cd %q && exec toolbox run --container %q llama-server -fa on --no-mmap --host 127.0.0.1 --port 8080 --models-preset models/config.ini --models-max 1 --models-autoload -cram 0 --spec-default --no-ui' \
		"$model_root" "$toolbox_container"
	tmux new-session -d -s "$llama_session" "$llama_command"
	started_sessions+=("$llama_session")
fi

wait_for_url "llama-server" "http://127.0.0.1:8080/models"

if session_exists "$app_session"; then
	echo "$app_session is already running"
elif port_is_listening 3000; then
	fail "Port 3000 is already owned outside $app_session"
else
	pnpm_path=$(command -v pnpm)
	printf -v app_command 'cd %q && exec %q dev --host 127.0.0.1' \
		"$repository_root" "$pnpm_path"
	tmux new-session -d -s "$app_session" "$app_command"
	started_sessions+=("$app_session")
fi

wait_for_url "Good Enough" "http://127.0.0.1:3000/"

trap - ERR INT TERM

echo
echo "Good Enough development services are running:"
echo "  tmux attach -t $llama_session"
echo "  tmux attach -t $app_session"
