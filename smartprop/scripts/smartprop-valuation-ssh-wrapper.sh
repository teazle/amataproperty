#!/bin/bash
set -euo pipefail

readonly UUID_RE='[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}'
readonly original_command="${SSH_ORIGINAL_COMMAND-}"
command=''
declare -a validated_args=()

if [[ "$original_command" == 'queue --json' ]]; then
  command='queue'
  validated_args=(--json)
elif [[ "$original_command" =~ ^heartbeat\ --run-id\ ($UUID_RE)\ --lease-token\ ($UUID_RE)\ --json$ ]]; then
  command='heartbeat'
  validated_args=(--run-id "${BASH_REMATCH[1]}" --lease-token "${BASH_REMATCH[2]}" --json)
elif [[ "$original_command" =~ ^import\ --run-id\ ($UUID_RE)\ --item-id\ ($UUID_RE)\ --lease-token\ ($UUID_RE)\ --json$ ]]; then
  command='import'
  validated_args=(--run-id "${BASH_REMATCH[1]}" --item-id "${BASH_REMATCH[2]}" --lease-token "${BASH_REMATCH[3]}" --json)
elif [[ "$original_command" =~ ^complete\ --run-id\ ($UUID_RE)\ --lease-token\ ($UUID_RE)\ --json$ ]]; then
  command='complete'
  validated_args=(--run-id "${BASH_REMATCH[1]}" --lease-token "${BASH_REMATCH[2]}" --json)
else
  printf '%s\n' 'valuation command denied' >&2
  exit 64
fi

exec /usr/bin/sudo -n /usr/local/libexec/smartprop-valuation-launcher "$command" "${validated_args[@]}"
