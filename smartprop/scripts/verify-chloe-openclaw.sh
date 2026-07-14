#!/usr/bin/env bash
set -Eeuo pipefail

TARGET=root@194.233.94.3
EXPECTED_HOSTNAME=vmi3136623
EXPECTED_IP=194.233.94.3
EXPECTED_VERSION=2026.7.1
EXPECTED_COMMIT=2d2ddc4
EXPECTED_MODEL=openai/gpt-5.6-sol
EXPECTED_THINKING=high
EXPECTED_RUN_ID=b8c35794-e6b7-4b25-ba33-a61420cb2966
EXPECTED_RESPONSE=CHLOE_SOL_HIGH_OK
EXPECTED_SESSION_KEY=agent:main:chloe-sol-high-live-proof-20260714-2208
EXPECTED_PROMPT='Final live verification. Reply exactly CHLOE_SOL_HIGH_OK'
REMOTE_TIMEOUT_SECONDS=120
MODE=controller
PREFLIGHT_VERSION=''

usage() {
  printf 'Usage: %s [--preflight-update=<exact-version>]\n' "$0" >&2
  exit 64
}

fail() {
  printf 'Chloe OpenClaw verification failed: %s\n' "$1" >&2
  exit 1
}

unexpected_failure() {
  local status="$?"
  printf 'Chloe OpenClaw verification failed: unexpected command failure in %s at line %s (exit %s)\n' \
    "$2" "$1" "$status" >&2
  exit "$status"
}

trap 'unexpected_failure "$LINENO" "${FUNCNAME[0]:-main}"' ERR

node_satisfies_engine() {
  local node_version="$1"
  local engine="$2"
  local semver_module
  semver_module="$(npm root -g)/npm/node_modules/semver"
  VERIFY_NODE_VERSION="$node_version" VERIFY_NODE_ENGINE="$engine" node - "$semver_module" <<'NODE'
const semver = require(process.argv[2]);
const compatible = semver.satisfies(
  process.env.VERIFY_NODE_VERSION.replace(/^v/, ''),
  process.env.VERIFY_NODE_ENGINE,
);
process.exit(compatible ? 0 : 1);
NODE
}

verify_values() {
  [[ "$actual_hostname" == "$EXPECTED_HOSTNAME" ]] || fail 'hostname mismatch'
  [[ "$actual_public_ip" == "$EXPECTED_IP" ]] || fail 'public IP mismatch'
  [[ "$actual_version" == "$EXPECTED_VERSION" ]] || fail 'OpenClaw version drift'
  [[ "$actual_commit" == "$EXPECTED_COMMIT" ]] || fail 'OpenClaw build commit drift'
  [[ "$package_version" == "$EXPECTED_VERSION" ]] || fail 'OpenClaw package version drift'
  [[ "$node_compatible" == true ]] || fail 'Node does not satisfy the installed OpenClaw engine'
  [[ "$service_active" == active ]] || fail 'gateway service is not active'
  [[ "$service_enabled" == enabled ]] || fail 'gateway service is not enabled'
  [[ "$service_restarts" == 0 ]] || fail 'gateway restart count is non-zero'
  [[ "$health_ok" == true && "$health_status" == live ]] || fail 'gateway health is not live'
  [[ "$config_valid" == true ]] || fail 'OpenClaw config is invalid'
  [[ "$gateway_rpc_ok" == true ]] || fail 'gateway RPC probe failed'
  [[ "$gateway_version" == "$EXPECTED_VERSION" ]] || fail 'running gateway version drift'
  [[ "$configured_model" == "$EXPECTED_MODEL" ]] || fail 'default model drift'
  [[ "$configured_thinking" == "$EXPECTED_THINKING" ]] || fail 'default thinking level drift'
  [[ "$main_is_default" == true ]] || fail 'main agent is not the effective default agent'
  [[ "$auth_usable" == true ]] || fail 'no usable OpenAI OAuth profile'
  [[ "$run_found" == true ]] || fail 'real Sol High proof run is missing'
  [[ "$run_status" == success ]] || fail 'real Sol High proof run did not succeed'
  [[ "$run_response" == "$EXPECTED_RESPONSE" ]] || fail 'real Sol High response marker mismatch'
  [[ "$run_provider" == openai ]] || fail 'real proof used the wrong provider'
  [[ "$run_model" == gpt-5.6-sol ]] || fail 'real proof used the wrong model'
  [[ "$run_thinking" == high ]] || fail 'real proof used the wrong thinking level'
  [[ "$run_fallback_used" == false ]] || fail 'real proof used a fallback model'
  [[ "$run_stop_reason" == stop ]] || fail 'real proof stop reason mismatch'
  [[ "$run_delivery_safe" == true ]] || fail 'real proof had an external delivery path'

  printf 'verifiedAt=%s\n' "$verified_at"
  printf 'target=%s hostname=%s publicIp=%s\n' "$TARGET" "$actual_hostname" "$actual_public_ip"
  printf 'openclaw=%s commit=%s node=%s nodeEngine=%s nodeCompatible=%s\n' \
    "$actual_version" "$actual_commit" "$node_version" "$node_engine" "$node_compatible"
  printf 'serviceActive=%s serviceEnabled=%s nRestarts=%s health=%s/%s gatewayRpc=%s gatewayVersion=%s\n' \
    "$service_active" "$service_enabled" "$service_restarts" "$health_ok" "$health_status" "$gateway_rpc_ok" "$gateway_version"
  printf 'configValid=%s model=%s thinking=%s mainDefault=%s authUsable=%s\n' \
    "$config_valid" "$configured_model" "$configured_thinking" "$main_is_default" "$auth_usable"
  printf 'runId=%s runStatus=%s response=%s provider=%s model=%s thinking=%s fallbackUsed=%s stopReason=%s deliverySafe=%s\n' \
    "$EXPECTED_RUN_ID" "$run_status" "$run_response" "$run_provider" "$run_model" "$run_thinking" \
    "$run_fallback_used" "$run_stop_reason" "$run_delivery_safe"
}

collect_test_values() {
  verified_at=2026-07-14T14:11:15Z
  actual_hostname="${CHLOE_TEST_HOSTNAME:?}"
  actual_public_ip="${CHLOE_TEST_PUBLIC_IP:?}"
  actual_version="${CHLOE_TEST_OPENCLAW_VERSION:?}"
  actual_commit="${CHLOE_TEST_OPENCLAW_COMMIT:?}"
  package_version="$actual_version"
  node_version="${CHLOE_TEST_NODE_VERSION:?}"
  node_engine="${CHLOE_TEST_NODE_ENGINE:?}"
  if node_satisfies_engine "$node_version" "$node_engine"; then node_compatible=true; else node_compatible=false; fi
  service_active="${CHLOE_TEST_SERVICE_ACTIVE:?}"
  service_enabled="${CHLOE_TEST_SERVICE_ENABLED:?}"
  service_restarts="${CHLOE_TEST_NRESTARTS:?}"
  health_ok="${CHLOE_TEST_HEALTH_OK:?}"
  health_status="${CHLOE_TEST_HEALTH_STATUS:?}"
  config_valid="${CHLOE_TEST_CONFIG_VALID:?}"
  gateway_rpc_ok="${CHLOE_TEST_GATEWAY_RPC_OK:?}"
  gateway_version="${CHLOE_TEST_GATEWAY_VERSION:?}"
  configured_model="${CHLOE_TEST_MODEL:?}"
  configured_thinking="${CHLOE_TEST_THINKING:?}"
  main_is_default="${CHLOE_TEST_MAIN_IS_DEFAULT:?}"
  auth_usable="${CHLOE_TEST_AUTH_USABLE:?}"
  run_found="${CHLOE_TEST_RUN_FOUND:?}"
  run_status="${CHLOE_TEST_RUN_STATUS:?}"
  run_response="${CHLOE_TEST_RUN_RESPONSE:?}"
  run_provider="${CHLOE_TEST_RUN_PROVIDER:?}"
  run_model="${CHLOE_TEST_RUN_MODEL:?}"
  run_thinking="${CHLOE_TEST_RUN_THINKING:?}"
  run_fallback_used="${CHLOE_TEST_RUN_FALLBACK_USED:?}"
  run_stop_reason="${CHLOE_TEST_RUN_STOP_REASON:?}"
  run_delivery_safe="${CHLOE_TEST_RUN_DELIVERY_SAFE:?}"
}

collect_live_values() {
  verified_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  actual_hostname="$(hostname -s)"
  actual_public_ip="$(hostname -I | tr ' ' '\n' | awk '$0 == "194.233.94.3" { print; exit }')"

  local version_line version_pattern openclaw_path package_path
  version_line="$(openclaw --version)"
  version_pattern='^OpenClaw[[:space:]]+([^[:space:]]+)[[:space:]]+\(([^)]+)\)$'
  [[ "$version_line" =~ $version_pattern ]] \
    || fail 'could not parse OpenClaw version output'
  actual_version="${BASH_REMATCH[1]}"
  actual_commit="${BASH_REMATCH[2]}"
  openclaw_path="$(readlink -f "$(command -v openclaw)")"
  package_path="$(dirname "$openclaw_path")/package.json"
  package_version="$(node -e 'const p=require(process.argv[1]); process.stdout.write(p.version)' "$package_path")"
  node_engine="$(node -e 'const p=require(process.argv[1]); process.stdout.write(p.engines.node)' "$package_path")"
  node_version="$(node --version | sed 's/^v//')"
  if node_satisfies_engine "$node_version" "$node_engine"; then node_compatible=true; else node_compatible=false; fi

  service_active="$(systemctl --user is-active openclaw-gateway.service)"
  service_enabled="$(systemctl --user is-enabled openclaw-gateway.service)"
  service_restarts="$(systemctl --user show openclaw-gateway.service -p NRestarts --value)"

  local health_json config_json gateway_json auth_json agents_json
  health_json="$(curl -fsS --max-time 10 http://127.0.0.1:20888/health)"
  health_ok="$(printf '%s' "$health_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).ok===true)))')"
  health_status="$(printf '%s' "$health_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).status??"")))')"
  config_json="$(openclaw config validate --json)"
  config_valid="$(printf '%s' "$config_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).valid===true)))')"
  agents_json="$(openclaw agents list --json)"
  configured_model="$(printf '%s' "$agents_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const main=JSON.parse(s).find(a=>a.id==="main");process.stdout.write(main?.model??"")})')"
  main_is_default="$(printf '%s' "$agents_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const main=JSON.parse(s).find(a=>a.id==="main");process.stdout.write(String(main?.isDefault===true))})')"
  configured_thinking="$(node -e '
const fs=require("fs");const x=JSON.parse(fs.readFileSync("/root/.openclaw/openclaw.json","utf8"));
const main=(x.agents?.list??[]).find(a=>a.id==="main");
process.stdout.write(main?.thinkingDefault??x.agents?.defaults?.thinkingDefault??"");
')"
  gateway_json="$(openclaw gateway status --json)"
  gateway_rpc_ok="$(printf '%s' "$gateway_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).rpc?.ok===true)))')"
  gateway_version="$(printf '%s' "$gateway_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.rpc?.server?.version??x.rpc?.version??"")})')"
  auth_json="$(openclaw models status --json)"
  auth_usable="$(printf '%s' "$auth_json" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const x=JSON.parse(s); const profiles=x.auth?.oauth?.profiles??[];
  const usable=profiles.some(p=>p.provider==="openai"&&p.status==="ok");
  process.stdout.write(String(usable));
})')"

  local trajectory_file run_json candidate
  trajectory_file=''
  while IFS= read -r candidate; do
    if grep -q "$EXPECTED_RUN_ID" "$candidate"; then
      trajectory_file="$candidate"
      break
    fi
  done < <(find /root/.openclaw/agents/main/sessions -type f -name '*.trajectory.jsonl' 2>/dev/null)
  if [[ -z "$trajectory_file" ]]; then
    run_found=false
    run_status=missing
    run_response=''
    run_provider=''
    run_model=''
    run_thinking=''
    run_fallback_used=true
    run_stop_reason=''
    run_delivery_safe=false
    return
  fi
  run_json="$(VERIFY_RUN_ID="$EXPECTED_RUN_ID" VERIFY_RESPONSE="$EXPECTED_RESPONSE" \
    VERIFY_SESSION_KEY="$EXPECTED_SESSION_KEY" VERIFY_PROMPT="$EXPECTED_PROMPT" \
    node - "$trajectory_file" <<'NODE'
const fs = require('fs');
const records = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse)
  .filter((item) => item.runId === process.env.VERIFY_RUN_ID);
const started = records.find((item) => item.type === 'session.started');
const metadata = records.find((item) => item.type === 'trace.metadata');
const completed = records.find((item) => item.type === 'model.completed');
const artifacts = records.find((item) => item.type === 'trace.artifacts');
const ended = records.find((item) => item.type === 'session.ended');
const sessionFile = started?.data?.sessionFile;
const startedAt = Date.parse(started?.ts ?? '');
const endedAt = Date.parse(ended?.ts ?? '');
let messageEntry;
if (sessionFile && fs.existsSync(sessionFile)) {
  const entries = fs.readFileSync(sessionFile, 'utf8').trim().split('\n').map(JSON.parse);
  const inRunWindow = (entry) => {
    const timestamp = Date.parse(entry.timestamp ?? '');
    return Number.isFinite(startedAt) && Number.isFinite(endedAt) && timestamp >= startedAt && timestamp <= endedAt;
  };
  const userEntry = entries.find((item) => item.message?.role === 'user' &&
    item.message?.content === process.env.VERIFY_PROMPT && inRunWindow(item));
  messageEntry = entries.find((item) => item.parentId === userEntry?.id &&
    item.message?.role === 'assistant' && inRunWindow(item) &&
    item.message?.content?.some?.((part) => part.text === process.env.VERIFY_RESPONSE));
}
const models = new Set(records.filter((item) => item.provider && item.modelId)
  .map((item) => `${item.provider}/${item.modelId}`));
const empty = (value) => !Array.isArray(value) || value.length === 0;
const deliverySafe = started?.data?.agentId === 'main' &&
  started?.data?.messageProvider === 'webchat' && started?.data?.messageChannel === 'webchat' &&
  metadata?.data?.metadata?.sessionKey === process.env.VERIFY_SESSION_KEY &&
  artifacts?.data?.didSendViaMessagingTool === false &&
  artifacts?.data?.didDeliverSourceReplyViaMessageTool !== true &&
  empty(artifacts?.data?.messagingToolSentTexts) && empty(artifacts?.data?.messagingToolSentMediaUrls) &&
  empty(artifacts?.data?.messagingToolSentTargets) &&
  Number(artifacts?.data?.successfulCronAdds ?? 0) === 0;
console.log(JSON.stringify({
  found: records.length > 0,
  status: ended?.data?.status ?? artifacts?.data?.finalStatus ?? 'missing',
  response: completed?.data?.assistantTexts?.includes(process.env.VERIFY_RESPONSE) ? process.env.VERIFY_RESPONSE : '',
  provider: metadata?.data?.model?.provider ?? metadata?.provider ?? '',
  model: metadata?.data?.model?.name ?? metadata?.modelId ?? '',
  thinking: metadata?.data?.model?.thinkLevel ?? '',
  fallbackUsed: records.some((item) => item.type === 'model.fallback_step') ||
    models.size !== 1 || !models.has('openai/gpt-5.6-sol'),
  stopReason: messageEntry?.message?.stopReason ?? '',
  deliverySafe,
}));
NODE
)"
  run_found="$(printf '%s' "$run_json" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).found')"
  run_status="$(printf '%s' "$run_json" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).status')"
  run_response="$(printf '%s' "$run_json" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).response')"
  run_provider="$(printf '%s' "$run_json" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).provider')"
  run_model="$(printf '%s' "$run_json" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).model')"
  run_thinking="$(printf '%s' "$run_json" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).thinking')"
  run_fallback_used="$(printf '%s' "$run_json" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).fallbackUsed')"
  run_stop_reason="$(printf '%s' "$run_json" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).stopReason')"
  run_delivery_safe="$(printf '%s' "$run_json" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).deliverySafe')"
}

preflight_update() {
  local target_version target_engine target_compatible metadata
  if [[ "$MODE" == local ]]; then
    target_version="${CHLOE_TEST_TARGET_VERSION:?}"
    target_engine="${CHLOE_TEST_TARGET_ENGINE:?}"
    if node_satisfies_engine "$node_version" "$target_engine"; then target_compatible=true; else target_compatible=false; fi
  else
    metadata="$(npm view "openclaw@$PREFLIGHT_VERSION" version engines.node --json)"
    target_version="$(printf '%s' "$metadata" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).version))')"
    target_engine="$(printf '%s' "$metadata" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);process.stdout.write(x["engines.node"]??x.engines?.node??"")})')"
    if node_satisfies_engine "$node_version" "$target_engine"; then target_compatible=true; else target_compatible=false; fi
  fi
  [[ "$target_version" == "$PREFLIGHT_VERSION" ]] || fail 'registry resolved a different target release'
  [[ "$target_compatible" == true ]] || fail 'current Node does not satisfy the target OpenClaw engine; upgrade Node before OpenClaw'
  printf 'updatePreflight=pass targetVersion=%s targetNodeEngine=%s currentNode=%s\n' \
    "$target_version" "$target_engine" "$node_version"
}

for argument in "$@"; do
  case "$argument" in
    --remote) MODE=remote ;;
    --local-test) MODE=local ;;
    --preflight-update=*) PREFLIGHT_VERSION="${argument#*=}" ;;
    *) usage ;;
  esac
done

[[ -z "$PREFLIGHT_VERSION" || "$PREFLIGHT_VERSION" =~ ^[0-9]{4}\.[0-9]+\.[0-9]+$ ]] || usage

case "$MODE" in
  local)
    [[ "${CHLOE_OPENCLAW_VERIFIER_TEST_MODE:-0}" == 1 ]] || usage
    collect_test_values
    verify_values
    [[ -z "$PREFLIGHT_VERSION" ]] || preflight_update
    printf 'verification=pass\n'
    ;;
  remote)
    collect_live_values
    verify_values
    [[ -z "$PREFLIGHT_VERSION" ]] || preflight_update
    printf 'verification=pass\n'
    ;;
  controller)
    remote_args=(--remote)
    [[ -z "$PREFLIGHT_VERSION" ]] || remote_args+=("--preflight-update=$PREFLIGHT_VERSION")
    perl -e 'alarm shift @ARGV; exec @ARGV' "$REMOTE_TIMEOUT_SECONDS" \
      ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 \
      -o ServerAliveInterval=10 -o ServerAliveCountMax=3 "$TARGET" \
      bash -s -- "${remote_args[@]}" < "$0"
    ;;
esac
