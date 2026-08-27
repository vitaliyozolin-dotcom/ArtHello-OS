#!/usr/bin/env bash
set -Eeuo pipefail
exec 9>/var/lock/school-1-11-auth-staging.lock
flock -n 9

production=school-1-11
staging=school-1-11-staging
network=school-1-11-staging-local
acceptance="school-1-11-auth-acceptance-$RUN_ID"
rollback="school-1-11-staging-rollback-$RUN_ID"
new_data="school-1-11_staging_auth_${RUN_ID}_data"
success=0
acceptance_created=0
old_renamed=0
new_created=0
new_data_created=0

case "$acceptance:$rollback:$new_data" in
  school-1-11-auth-acceptance-*:school-1-11-staging-rollback-*:school-1-11_staging_auth_*_data) ;;
  *) printf 'Invalid staging target names\n' >&2; exit 1 ;;
esac

cleanup() {
  rc=$?
  trap - EXIT
  set +e
  if [ "$acceptance_created" -eq 1 ]; then
    docker rm -f "$acceptance" >/dev/null 2>&1
  fi
  if [ "$success" -ne 1 ]; then
    if [ "$new_created" -eq 1 ]; then
      docker rm -f "$staging" >/dev/null 2>&1
    fi
    if [ "$old_renamed" -eq 1 ]; then
      docker rename "$rollback" "$staging" >/dev/null 2>&1
      if [ "$(docker inspect "$staging" --format '{{.State.Running}}' 2>/dev/null)" != true ]; then
        docker start "$staging" >/dev/null 2>&1
      fi
    fi
    if [ "$new_data_created" -eq 1 ]; then
      docker volume rm "$new_data" >/dev/null 2>&1
    fi
    printf 'SCHOOL_AUTH_STAGING_ROLLBACK=ATTEMPTED\n' >&2
  fi
  exit "$rc"
}
trap cleanup EXIT

test "$(docker inspect "$production" --format '{{.State.Running}}')" = true
test "$(docker inspect "$production" --format '{{.State.Health.Status}}')" = healthy
production_started_before="$(docker inspect "$production" --format '{{.State.StartedAt}}')"
curl -fsS --max-time 30 "$SCHOOL_ORIGIN/api/health" | grep -F '"status":"ok"' >/dev/null

test "$(docker inspect "$staging" --format '{{.State.Running}}')" = true
curl -fsS --max-time 15 "$STAGING_ORIGIN/api/health" | grep -F '"status":"ok"' >/dev/null
test "$(docker network inspect "$network" --format '{{index .Options "com.docker.network.bridge.enable_ip_masquerade"}}')" = false
test "$(docker network inspect "$network" --format '{{index .Options "com.docker.network.bridge.enable_icc"}}')" = false
test -z "$(docker ps -aq --filter "name=^/$acceptance$")"
test -z "$(docker ps -aq --filter "name=^/$rollback$")"
if docker volume inspect "$new_data" >/dev/null 2>&1; then
  printf 'Candidate data volume already exists\n' >&2
  exit 1
fi

candidate_image_id="$(docker image inspect "$CANDIDATE_IMAGE" --format '{{.Id}}')"
test -n "$candidate_image_id"
old_image="$(docker inspect "$staging" --format '{{.Config.Image}}')"
old_data="$(docker inspect "$staging" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')"
backup_volume="$(docker inspect "$staging" --format '{{range .Mounts}}{{if eq .Destination "/backups"}}{{.Name}}{{end}}{{end}}')"
source_backup="$(docker inspect "$staging" --format '{{index .Config.Labels "school.source-backup"}}')"
staging_secret="$(docker inspect "$staging" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^CENTRAL_ACCESS_SECRET=//p' | head -n1)"
test -n "$old_image"
test -n "$old_data"
test -n "$backup_volume"
test "${#staging_secret}" -eq 64
case "$source_backup" in
  design-system/*-run-*) ;;
  *) printf 'Invalid staging source backup\n' >&2; exit 1 ;;
esac
binding="$(docker inspect "$staging" | python3 -c 'import json,sys; d=json.load(sys.stdin)[0]; b=d["HostConfig"]["PortBindings"]["3000/tcp"][0]; print(b["HostIp"]+":"+b["HostPort"])')"
test "$binding" = "127.0.0.1:$STAGING_PORT"

backup_path="$(docker exec "$staging" node scripts/backup-db.mjs | tail -n1)"
case "$backup_path" in
  /backups/school-1-11-*.sqlite) ;;
  *) printf 'Unexpected staging backup path\n' >&2; exit 1 ;;
esac
backup_file="${backup_path#/backups/}"
case "$backup_file" in
  school-1-11-*.sqlite) ;;
  *) printf 'Unexpected staging backup file\n' >&2; exit 1 ;;
esac
docker exec -i -e BACKUP_PATH="$backup_path" "$staging" node --input-type=module - <<'VERIFY_BACKUP'
import { DatabaseSync } from 'node:sqlite';
import { statSync } from 'node:fs';
const path = process.env.BACKUP_PATH;
const stat = statSync(path);
if (!stat.isFile() || stat.size < 4096) throw new Error('Staging backup is empty');
const db = new DatabaseSync(path, { readOnly: true });
const rows = db.prepare('PRAGMA integrity_check').all();
if (rows.length !== 1 || rows[0].integrity_check !== 'ok') throw new Error('Staging backup integrity failed');
db.close();
console.log('SCHOOL_AUTH_STAGING_BACKUP=OK bytes=' + stat.size);
VERIFY_BACKUP

docker volume create \
  --label school.system=school-1-11 \
  --label school.environment=staging \
  --label school.purpose=auth-candidate-data \
  --label school.candidate-sha="$CANDIDATE_SHA" \
  "$new_data" >/dev/null
new_data_created=1

docker run --rm -i --network none --user 0:0 \
  -e BACKUP_FILE="$backup_file" \
  -v "$backup_volume:/backup:ro" \
  -v "$new_data:/data" \
  --entrypoint node "$CANDIDATE_IMAGE" --input-type=module - <<'PREPARE_DATA'
import { chmodSync, chownSync, copyFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const file = process.env.BACKUP_FILE;
if (!/^school-1-11-[0-9TZ.-]+\.sqlite$/.test(file)) throw new Error('Invalid backup file');
const target = '/data/school-1-11.sqlite';
copyFileSync('/backup/' + file, target);
chownSync('/data', 1001, 1001);
chmodSync('/data', 0o750);
chownSync(target, 1001, 1001);
chmodSync(target, 0o640);
const db = new DatabaseSync(target, { readOnly: true });
const rows = db.prepare('PRAGMA integrity_check').all();
if (rows.length !== 1 || rows[0].integrity_check !== 'ok') throw new Error('Candidate data integrity failed');
db.close();
console.log('SCHOOL_AUTH_CANDIDATE_DATA=OK');
PREPARE_DATA

acceptance_secret="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
test "${#acceptance_secret}" -eq 64
docker run -d \
  --name "$acceptance" \
  --network none \
  --security-opt no-new-privileges:true \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DATABASE_PATH=/data/school-1-11.sqlite \
  -e PUBLIC_APP_ORIGIN="$SCHOOL_ORIGIN" \
  -e CENTRAL_ACCESS_SECRET="$acceptance_secret" \
  -v "$new_data:/data" \
  -v "$backup_volume:/backups" \
  "$CANDIDATE_IMAGE" >/dev/null
acceptance_created=1

acceptance_healthy=0
for attempt in $(seq 1 90); do
  if docker exec "$acceptance" node -e \
    "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then
    acceptance_healthy=1
    break
  fi
  if [ "$(docker inspect "$acceptance" --format '{{.State.Running}}' 2>/dev/null || true)" != true ]; then
    break
  fi
  sleep 2
done
if [ "$acceptance_healthy" -ne 1 ]; then
  docker logs "$acceptance" --tail 120 >&2 || true
  exit 1
fi

docker exec -i -e EXPECTED_ORIGIN="$SCHOOL_ORIGIN" "$acceptance" node --input-type=module - <<'VERIFY_PROXY_AUTH'
const endpoint = 'http://127.0.0.1:3000/api/auth/login';
const body = JSON.stringify({ login: '+79990000000', password: 'InvalidPassword1' });
const acceptedOrigin = await fetch(endpoint, {
  method: 'POST',
  headers: { origin: process.env.EXPECTED_ORIGIN, 'content-type': 'application/json' },
  body,
});
const acceptedPayload = await acceptedOrigin.json();
if (acceptedOrigin.status !== 401 || acceptedPayload.error !== 'Неверный логин или пароль')
  throw new Error('Canonical public Origin was not accepted: ' + JSON.stringify(acceptedPayload));

const rejectedOrigin = await fetch(endpoint, {
  method: 'POST',
  headers: { origin: 'https://evil.invalid', 'content-type': 'application/json' },
  body,
});
const rejectedPayload = await rejectedOrigin.json();
if (rejectedOrigin.status !== 401 || rejectedPayload.error !== 'Запрос отклонён системой безопасности')
  throw new Error('Foreign Origin was not rejected: ' + JSON.stringify(rejectedPayload));
console.log('SCHOOL_AUTH_PROXY_ORIGIN=ACCEPTED');
console.log('SCHOOL_AUTH_FOREIGN_ORIGIN=REJECTED');
VERIFY_PROXY_AUTH

docker rm -f "$acceptance" >/dev/null
acceptance_created=0

docker rename "$staging" "$rollback"
old_renamed=1
docker stop -t 30 "$rollback" >/dev/null

docker run -d \
  --name "$staging" \
  --restart unless-stopped \
  --network "$network" \
  -p "127.0.0.1:$STAGING_PORT:3000" \
  --security-opt no-new-privileges:true \
  --health-cmd "node -e \"fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\"" \
  --health-interval 30s \
  --health-timeout 5s \
  --health-retries 5 \
  --health-start-period 30s \
  --label school.system=school-1-11 \
  --label school.environment=staging \
  --label school.source-backup="$source_backup" \
  --label school.workflow-sha="$WORKFLOW_SHA" \
  --label school.candidate-sha="$CANDIDATE_SHA" \
  --label school.rollback-container="$rollback" \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DATABASE_PATH=/data/school-1-11.sqlite \
  -e PUBLIC_APP_ORIGIN="$STAGING_ORIGIN" \
  -e CENTRAL_ACCESS_SECRET="$staging_secret" \
  -v "$new_data:/data" \
  -v "$backup_volume:/backups" \
  "$CANDIDATE_IMAGE" >/dev/null
new_created=1

staging_healthy=0
for attempt in $(seq 1 90); do
  if curl -fsS --max-time 5 "$STAGING_ORIGIN/api/health" | grep -F '"status":"ok"' >/dev/null &&
    [ "$(docker inspect "$staging" --format '{{.State.Health.Status}}' 2>/dev/null || true)" = healthy ]; then
    staging_healthy=1
    break
  fi
  if [ "$(docker inspect "$staging" --format '{{.State.Running}}' 2>/dev/null || true)" != true ]; then
    break
  fi
  sleep 2
done
if [ "$staging_healthy" -ne 1 ]; then
  docker logs "$staging" --tail 120 >&2 || true
  exit 1
fi

docker exec -i -e EXPECTED_ORIGIN="$STAGING_ORIGIN" "$staging" node --input-type=module - <<'VERIFY_STAGING'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/data/school-1-11.sqlite', { readOnly: true });
const rows = db.prepare('PRAGMA integrity_check').all();
if (rows.length !== 1 || rows[0].integrity_check !== 'ok') throw new Error('Staging integrity failed');
const tableCount = db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get().count;
db.close();

const base = 'http://127.0.0.1:3000';
const health = await fetch(base + '/api/health');
if (!health.ok || !(await health.text()).includes('"status":"ok"')) throw new Error('Staging health failed');
const login = await fetch(base + '/login');
const html = await login.text();
if (!login.ok || html.length < 1000 || !html.includes('<html')) throw new Error('Staging login failed');

const body = JSON.stringify({ login: '+79990000000', password: 'InvalidPassword1' });
const auth = await fetch(base + '/api/auth/login', {
  method: 'POST',
  headers: { origin: process.env.EXPECTED_ORIGIN, 'content-type': 'application/json' },
  body,
});
const payload = await auth.json();
if (auth.status !== 401 || payload.error !== 'Неверный логин или пароль')
  throw new Error('Staging auth contract failed: ' + JSON.stringify(payload));
console.log('SCHOOL_AUTH_STAGING_DB=OK tables=' + tableCount);
console.log('SCHOOL_AUTH_STAGING_LOGIN=OK');
console.log('SCHOOL_AUTH_STAGING_SAME_ORIGIN=OK');
VERIFY_STAGING

new_binding="$(docker inspect "$staging" | python3 -c 'import json,sys; d=json.load(sys.stdin)[0]; b=d["HostConfig"]["PortBindings"]["3000/tcp"][0]; print(b["HostIp"]+":"+b["HostPort"])')"
test "$new_binding" = "127.0.0.1:$STAGING_PORT"
test "$(docker inspect "$staging" --format '{{.Config.Image}}')" = "$CANDIDATE_IMAGE"
test "$(docker inspect "$staging" --format '{{.State.Health.Status}}')" = healthy
test "$(docker inspect "$rollback" --format '{{.State.Running}}')" = false
test "$(docker network inspect "$network" --format '{{index .Options "com.docker.network.bridge.enable_ip_masquerade"}}')" = false
test "$(docker network inspect "$network" --format '{{index .Options "com.docker.network.bridge.enable_icc"}}')" = false

test "$(docker inspect "$production" --format '{{.State.StartedAt}}')" = "$production_started_before"
test "$(docker inspect "$production" --format '{{.State.Health.Status}}')" = healthy
curl -fsS --max-time 30 "$SCHOOL_ORIGIN/api/health" | grep -F '"status":"ok"' >/dev/null

success=1
printf 'SCHOOL_AUTH_STAGING=OK container=%s\n' "$staging"
printf 'SCHOOL_AUTH_CANDIDATE_SHA=%s\n' "$CANDIDATE_SHA"
printf 'SCHOOL_AUTH_STAGING_BIND=%s\n' "$new_binding"
printf 'SCHOOL_AUTH_STAGING_PUBLIC=no\n'
printf 'SCHOOL_AUTH_ROLLBACK_READY=%s\n' "$rollback"
printf 'SCHOOL_AUTH_PRODUCTION_RESTARTED=no\n'
printf 'SCHOOL_AUTH_PRODUCTION_HEALTH=OK\n'
