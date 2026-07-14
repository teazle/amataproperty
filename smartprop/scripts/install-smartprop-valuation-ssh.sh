#!/bin/bash
set -euo pipefail

readonly account='smartprop-valuation'
readonly home_dir='/var/lib/smartprop-valuation'
readonly source_ip='194.233.94.3'
readonly libexec_dir='/usr/local/libexec'
readonly sudoers_path='/etc/sudoers.d/smartprop-valuation'
readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ${EUID} -ne 0 ]]; then
  printf '%s\n' 'run this installer as root' >&2
  exit 1
fi
if [[ $# -ne 1 || ! -f "$1" ]]; then
  printf '%s\n' 'usage: install-smartprop-valuation-ssh.sh PUBLIC_KEY_FILE' >&2
  exit 2
fi

public_key="$(<"$1")"
if [[ "$public_key" == *$'\n'* || ! "$public_key" =~ ^(ssh-ed25519|sk-ssh-ed25519@openssh.com)[[:space:]][A-Za-z0-9+/=]+([[:space:]].*)?$ ]]; then
  printf '%s\n' 'the public key file is invalid' >&2
  exit 2
fi
/usr/bin/ssh-keygen -l -f "$1" >/dev/null

if ! /usr/bin/getent passwd "$account" >/dev/null; then
  /usr/sbin/useradd --system --create-home --home-dir "$home_dir" --shell /bin/bash "$account"
fi
/usr/sbin/usermod --home "$home_dir" --shell /bin/bash "$account"
/usr/bin/passwd --lock "$account" >/dev/null

/usr/bin/install -d -o root -g root -m 0755 "$libexec_dir"
/usr/bin/install -o root -g root -m 0755 \
  "$script_dir/smartprop-valuation-ssh-wrapper.sh" \
  "$libexec_dir/smartprop-valuation-ssh-wrapper"
/usr/bin/install -o root -g root -m 0755 \
  "$script_dir/smartprop-valuation-launcher.sh" \
  "$libexec_dir/smartprop-valuation-launcher"

sudoers_tmp="$(/usr/bin/mktemp)"
authorized_tmp="$(/usr/bin/mktemp)"
trap '/usr/bin/rm -f "$sudoers_tmp" "$authorized_tmp"' EXIT
/usr/bin/printf '%s\n' \
  'smartprop-valuation ALL=(root) NOPASSWD: /usr/local/libexec/smartprop-valuation-launcher *' \
  >"$sudoers_tmp"
/usr/sbin/visudo -cf "$sudoers_tmp" >/dev/null
/usr/bin/install -o root -g root -m 0440 "$sudoers_tmp" "$sudoers_path"
/usr/sbin/visudo -cf "$sudoers_path" >/dev/null

/usr/bin/install -d -o root -g root -m 0755 "$home_dir/.ssh"
/usr/bin/printf '%s %s\n' \
  "from=\"$source_ip\",command=\"$libexec_dir/smartprop-valuation-ssh-wrapper\",restrict,no-pty,no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-user-rc" \
  "$public_key" >"$authorized_tmp"
/usr/bin/install -o root -g root -m 0644 "$authorized_tmp" "$home_dir/.ssh/authorized_keys"

printf '%s\n' 'restricted valuation SSH account installed'
