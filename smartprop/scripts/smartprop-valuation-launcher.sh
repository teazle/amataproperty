#!/bin/bash
set -euo pipefail

readonly UUID_RE='^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
declare -a input_args=("$@")

reject() {
  printf '%s\n' 'command arguments do not match the restricted grammar' >&2
  exit 64
}

valid_uuid() {
  [[ "$1" =~ $UUID_RE ]]
}

[[ ${EUID} -eq 0 ]] || reject
case "${input_args[0]-}" in
  queue)
    [[ ${#input_args[@]} -eq 2 && "${input_args[1]}" == '--json' ]] ||
      { printf '%s\n' 'command arguments do not match' >&2; exit 64; }
    ;;
  heartbeat|complete)
    [[ ${#input_args[@]} -eq 6 && "${input_args[1]}" == '--run-id' &&
       "${input_args[3]}" == '--lease-token' && "${input_args[5]}" == '--json' ]] ||
      { printf '%s\n' 'command arguments do not match' >&2; exit 64; }
    valid_uuid "${input_args[2]}" && valid_uuid "${input_args[4]}" || reject
    ;;
  import)
    [[ ${#input_args[@]} -eq 8 && "${input_args[1]}" == '--run-id' &&
       "${input_args[3]}" == '--item-id' && "${input_args[5]}" == '--lease-token' &&
       "${input_args[7]}" == '--json' ]] ||
      { printf '%s\n' 'command arguments do not match' >&2; exit 64; }
    valid_uuid "${input_args[2]}" && valid_uuid "${input_args[4]}" &&
      valid_uuid "${input_args[6]}" || reject
    ;;
  *) reject ;;
esac

# Sudo normally resets the environment; clear it again before loading the
# root-owned application environment so caller values cannot override it.
while IFS='=' read -r name _; do
  if [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    case "$name" in
      BASHOPTS|BASHPID|EUID|PPID|SHELLOPTS|UID) ;;
      *) unset "$name" 2>/dev/null || true ;;
    esac
  fi
done < <(/usr/bin/env)

umask 077

readonly env_file=/etc/smartprop/smartprop.env
[[ -f "$env_file" && ! -L "$env_file" ]] || reject
read -r env_uid env_gid env_mode < <(/usr/bin/stat -c '%u %g %a' "$env_file")
[[ $env_uid == 0 && $env_gid == 0 ]] || reject
env_permissions=$((8#$env_mode))
(( (env_permissions & 8#022) == 0 )) || reject
set -a
# shellcheck disable=SC1091
source /etc/smartprop/smartprop.env
set +a

PATH=/usr/local/bin:/usr/bin:/bin
HOME=/var/lib/smartprop-valuation
export PATH HOME

cd /opt/smartprop/app/smartprop
exec /root/.bun/bin/bun scripts/run-chloe-valuation-refresh.ts "${input_args[@]}"
