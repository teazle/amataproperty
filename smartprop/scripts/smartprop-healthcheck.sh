#!/usr/bin/env bash
set -u

APP_DIR="/opt/smartprop/app/smartprop"
LOG_DIR="/opt/smartprop/logs"
LOG_FILE="$LOG_DIR/smartprop-healthcheck.log"
APP_BASE_URL="${APP_BASE_URL:-http://127.0.0.1:3000}"
SCHEDULER_MIN_ACTIVE_JOBS="${SCHEDULER_MIN_ACTIVE_JOBS:-2}"
SCRAPER_JOB_MAX_AGE_HOURS="${SCRAPER_JOB_MAX_AGE_HOURS:-36}"
ARTICLE_MAX_AGE_HOURS="${ARTICLE_MAX_AGE_HOURS:-168}"
export HOME="${HOME:-/root}"
export PM2_HOME="${PM2_HOME:-/root/.pm2}"
export PATH="/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
ADMIN_COOKIE=""

mkdir -p "$LOG_DIR"

log() {
  local level="$1"
  shift
  printf "[%s] [%s] %s\n" "$(date "+%Y-%m-%d %H:%M:%S")" "$level" "$*" | tee -a "$LOG_FILE"
}

rotate_log() {
  if [ -f "$LOG_FILE" ] && [ "$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 10485760 ]; then
    mv "$LOG_FILE" "$LOG_FILE.old"
  fi
}

get_admin_cookie() {
  if [ -n "$ADMIN_COOKIE" ]; then
    printf "%s" "$ADMIN_COOKIE"
    return 0
  fi

  local admin_password response cookie
  admin_password="$(cd "$APP_DIR" && node -e 'require("dotenv").config({ path: ".env.local", override: false, quiet: true }); process.stdout.write(process.env.ADMIN_PASSWORD || "amataadmin")' 2>/dev/null || true)"

  if [ -z "$admin_password" ]; then
    return 1
  fi

  response="$(curl -sS --max-time 10 -i \
    -X POST "$APP_BASE_URL/api/admin/auth/login" \
    -H "Content-Type: application/json" \
    --data "$(node -e 'console.log(JSON.stringify({ password: process.argv[1] }))' "$admin_password")" 2>/dev/null || true)"

  cookie="$(printf "%s" "$response" | awk 'BEGIN{IGNORECASE=1} /^set-cookie:/ { sub(/\r$/, ""); sub(/^set-cookie:[[:space:]]*/, ""); split($0, parts, ";"); print parts[1]; exit }')"

  if [ -z "$cookie" ]; then
    return 1
  fi

  ADMIN_COOKIE="$cookie"
  printf "%s" "$ADMIN_COOKIE"
  return 0
}

admin_get() {
  local endpoint cookie
  endpoint="$1"
  cookie="$(get_admin_cookie)" || return 1
  curl -sS --max-time 10 -H "Cookie: $cookie" "$APP_BASE_URL$endpoint"
}

admin_post() {
  local endpoint cookie
  endpoint="$1"
  cookie="$(get_admin_cookie)" || return 1
  curl -sS --max-time 30 -X POST -H "Cookie: $cookie" "$APP_BASE_URL$endpoint"
}

check_pm2() {
  if ! command -v pm2 >/dev/null 2>&1; then
    log ERROR "pm2 missing"
    return 1
  fi

  local proc pid status
  for proc in smartprop scraper-worker; do
    pid="$(pm2 pid "$proc" 2>/dev/null || echo 0)"
    if [ "$pid" != "0" ] && [ -n "$pid" ]; then
      status="online"
    else
      status="missing"
    fi

    if [ "$status" != "online" ]; then
      log WARN "pm2 process $proc is $status; restarting"
      pm2 restart "$proc" --update-env >/dev/null 2>&1 || return 1
    fi
  done

  return 0
}

check_docker() {
  if [ ! -x /usr/bin/dockerd ]; then
    log CRITICAL "/usr/bin/dockerd missing; possible compromise or package damage, not auto-reinstalling"
    return 1
  fi

  if ! systemctl is-active --quiet docker; then
    log WARN "docker inactive; restarting"
    systemctl reset-failed docker >/dev/null 2>&1 || true
    systemctl restart docker || return 1
  fi

  cd "$APP_DIR" || return 1
  local svc
  for svc in flaresolverr waha; do
    if ! docker compose -f docker-compose.prod.yml ps --services --filter status=running 2>/dev/null | grep -qx "$svc"; then
      log WARN "compose service $svc not running; starting"
      docker compose -f docker-compose.prod.yml up -d "$svc" >/dev/null || return 1
    fi
  done

  return 0
}

check_http() {
  local app_code flaresolverr_code

  app_code="$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" "$APP_BASE_URL/api/health" 2>/dev/null || echo 000)"
  if [ "$app_code" != "200" ]; then
    log WARN "app health returned HTTP $app_code; restarting smartprop"
    pm2 restart smartprop --update-env >/dev/null 2>&1 || true
    return 1
  fi

  flaresolverr_code="$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8191/v1 -H "Content-Type: application/json" -d "{\"cmd\":\"sessions.list\"}" 2>/dev/null || echo 000)"
  if [ "$flaresolverr_code" != "200" ]; then
    log WARN "flaresolverr returned HTTP $flaresolverr_code; recreating sidecar"
    cd "$APP_DIR" && docker compose -f docker-compose.prod.yml up -d --force-recreate flaresolverr >/dev/null || true
    return 1
  fi

  return 0
}

check_scheduler() {
  local status_json active_jobs initialized jobs_json enabled_jobs failed_jobs stale_jobs

  status_json="$(admin_get "/api/scheduler/status" 2>/dev/null || true)"
  active_jobs="$(printf "%s" "$status_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s); console.log(Number(j.activeJobs||0));}catch{console.log(0)}})' 2>/dev/null || echo 0)"
  initialized="$(printf "%s" "$status_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s); console.log(j.initialized === true ? "true" : "false");}catch{console.log("false")}})' 2>/dev/null || echo false)"

  if [ "$initialized" != "true" ] || [ "$active_jobs" -lt "$SCHEDULER_MIN_ACTIVE_JOBS" ]; then
    log WARN "scheduler unhealthy initialized=$initialized activeJobs=$active_jobs; reloading"
    admin_post "/api/scheduler/reload" >/dev/null 2>&1 || true
    sleep 5
    status_json="$(admin_get "/api/scheduler/status" 2>/dev/null || true)"
    active_jobs="$(printf "%s" "$status_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s); console.log(Number(j.activeJobs||0));}catch{console.log(0)}})' 2>/dev/null || echo 0)"
    initialized="$(printf "%s" "$status_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s); console.log(j.initialized === true ? "true" : "false");}catch{console.log("false")}})' 2>/dev/null || echo false)"
  fi

  if [ "$initialized" != "true" ] || [ "$active_jobs" -lt "$SCHEDULER_MIN_ACTIVE_JOBS" ]; then
    log ERROR "scheduler still unhealthy initialized=$initialized activeJobs=$active_jobs"
    return 1
  fi

  jobs_json="$(admin_get "/api/scheduler/jobs" 2>/dev/null || true)"
  enabled_jobs="$(printf "%s" "$jobs_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const jobs=JSON.parse(s).jobs||[]; console.log(jobs.filter(j=>j.enabled).length)}catch{console.log(0)}})' 2>/dev/null || echo 0)"
  failed_jobs="$(printf "%s" "$jobs_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const jobs=JSON.parse(s).jobs||[]; console.log(jobs.filter(j=>j.enabled && j.last_run_status==="failed").map(j=>j.name).join(","))}catch{console.log("parse-error")}})' 2>/dev/null || echo parse-error)"
  stale_jobs="$(printf "%s" "$jobs_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const maxMs=Number(process.env.SCRAPER_JOB_MAX_AGE_HOURS||36)*3600*1000; const jobs=(JSON.parse(s).jobs||[]).filter(j=>j.enabled && j.last_run_at && Date.now()-Date.parse(j.last_run_at)>maxMs); console.log(jobs.map(j=>j.name).join(','));}catch{console.log('parse-error')}})" 2>/dev/null || echo parse-error)"

  if [ "$enabled_jobs" -gt "$active_jobs" ]; then
    log ERROR "scheduler has $active_jobs active job(s) but $enabled_jobs enabled DB job(s)"
    return 1
  fi

  if [ -n "$failed_jobs" ]; then
    log ERROR "scheduled scraper job(s) failed: $failed_jobs"
    return 1
  fi

  if [ -n "$stale_jobs" ]; then
    log ERROR "scheduled scraper job(s) stale beyond ${SCRAPER_JOB_MAX_AGE_HOURS}h: $stale_jobs"
    return 1
  fi

  return 0
}

check_scraper_runtime() {
  cd "$APP_DIR" || return 1

  if ! bun scripts/scraper-health.ts >/tmp/smartprop-scraper-health.json 2>/tmp/smartprop-scraper-health.err; then
    log ERROR "scraper runtime health failed: $(tr "\n" " " </tmp/smartprop-scraper-health.err | cut -c1-300)"
    return 1
  fi

  return 0
}

check_scraper_locks() {
  local lock pid age_seconds lock_name

  cd "$APP_DIR" || return 1
  for lock in storage/pg-scraper.lock storage/ep-scraper.lock storage/article-scraper.lock; do
    [ -f "$lock" ] || continue
    lock_name="$(basename "$lock")"
    pid="$(node -e "try{const f=require('fs').readFileSync('$lock','utf8'); const j=JSON.parse(f); console.log(j.pid||'')}catch{console.log('')}" 2>/dev/null || echo)"

    if [ -z "$pid" ] || ! kill -0 "$pid" >/dev/null 2>&1; then
      log WARN "removing stale scraper lock $lock_name pid=${pid:-missing}"
      rm -f "$lock"
      continue
    fi

    age_seconds="$(($(date +%s) - $(stat -c %Y "$lock" 2>/dev/null || date +%s)))"
    if [ "$age_seconds" -gt 21600 ]; then
      log ERROR "scraper lock $lock_name is older than 6h and pid $pid is still running"
      return 1
    fi
  done

  return 0
}

check_articles() {
  cd "$APP_DIR" || return 1

  ARTICLE_MAX_AGE_HOURS="$ARTICLE_MAX_AGE_HOURS" bun -e '
    import { createClient } from "@supabase/supabase-js";
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
    const staleCutoff = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const stopped = await supabase
      .from("scrape_sessions")
      .update({
        status: "stopped",
        completed_at: new Date().toISOString(),
        error_message: "stale running article session auto-stopped by healthcheck"
      })
      .eq("status", "running")
      .lt("started_at", staleCutoff)
      .select("id");
    if (stopped.error) throw stopped.error;

    const latest = await supabase
      .from("scraped_articles")
      .select("last_scraped_at,title")
      .order("last_scraped_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) throw latest.error;
    if (!latest.data?.last_scraped_at) throw new Error("no scraped articles found");

    const maxAgeHours = Number(process.env.ARTICLE_MAX_AGE_HOURS || 168);
    const ageHours = (Date.now() - Date.parse(latest.data.last_scraped_at)) / 3600000;
    if (ageHours > maxAgeHours) {
      throw new Error(`articles stale: latest=${latest.data.last_scraped_at}, ageHours=${ageHours.toFixed(1)}`);
    }

    console.log(JSON.stringify({ latest: latest.data.last_scraped_at, staleSessionsStopped: stopped.data?.length || 0 }));
  ' >/tmp/smartprop-article-health.json 2>/tmp/smartprop-article-health.err

  if [ "$?" -ne 0 ]; then
    log ERROR "article freshness failed: $(tr "\n" " " </tmp/smartprop-article-health.err | cut -c1-300)"
    return 1
  fi

  return 0
}

check_malware_markers() {
  local root_execs markers f

  root_execs="$(find / -xdev -maxdepth 1 -type f -perm /111 -printf "%p " 2>/dev/null || true)"
  markers=""
  for f in /tmp/install.sh /tmp/let /dev/shm/let /etc/let /var/let /root/install.sh /var/tmp/install.sh /let; do
    [ -e "$f" ] && markers="$markers $f"
  done

  if [ -n "$root_execs$markers" ]; then
    log CRITICAL "suspicious artifacts detected: root_execs=[$root_execs] markers=[$markers]"
    return 1
  fi

  return 0
}

main() {
  rotate_log
  local errors=0

  check_malware_markers || errors=$((errors + 1))
  check_pm2 || errors=$((errors + 1))
  check_docker || errors=$((errors + 1))
  check_http || errors=$((errors + 1))
  check_scheduler || errors=$((errors + 1))
  check_scraper_runtime || errors=$((errors + 1))
  check_scraper_locks || errors=$((errors + 1))
  check_articles || errors=$((errors + 1))

  if [ "$errors" -eq 0 ]; then
    log INFO "healthy"
    exit 0
  fi

  log ERROR "healthcheck completed with $errors issue(s)"
  exit 1
}

main "$@"
