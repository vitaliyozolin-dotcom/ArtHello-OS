#!/usr/bin/env bash
# Hosted-only Linux/Docker integration: real non-root :443 + Docker DNS + TLS.
# The mock connector exists only in this fixture; production relay's destination
# remains the hard-coded ArtHello IP. This script carries no production secrets.
set -Eeuo pipefail
umask 077
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
: "${RUNNER_TEMP:?hosted runner temp required}"
: "${GITHUB_RUN_ID:?hosted run required}"
[[ "$GITHUB_RUN_ID" =~ ^[1-9][0-9]*$ ]]
[[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]]
test -s deploy/school/sso-relay-r3/relay.mjs
key="school-relay-test-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
work="$(mktemp -d "$RUNNER_TEMP/$key.XXXXXX")"
network_school="$key-school"
network_mock="$key-mock"
school="$key-client"
relay="$key-relay"
upstream="$key-upstream"
image=node:24-bookworm-slim
hostname=arthello-188-225-38-55.sslip.io
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  docker rm -f "$relay" "$school" "$upstream" >/dev/null 2>&1 || true
  docker network rm "$network_school" "$network_mock" >/dev/null 2>&1 || true
  rm -rf -- "$work"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# The fixture private key is disposable, generated for this isolated test only.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$work/mock.key" -out "$work/mock.crt" \
  -subj "/CN=$hostname" -addext "subjectAltName=DNS:$hostname" \
  >/dev/null 2>&1
cat > "$work/upstream.mjs" <<'JS'
import https from 'node:https';
import { readFileSync } from 'node:fs';
https.createServer({key:readFileSync('/fixtures/mock.key'),cert:readFileSync('/fixtures/mock.crt')},(req,res)=>{
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({status:'ok',path:req.url}));
}).listen(8443,'0.0.0.0',()=>console.log('MOCK_TLS_UPSTREAM_READY'));
JS
cat > "$work/relay-fixture.mjs" <<'JS'
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import net from 'node:net';
import { createRelay } from '/relay/relay.mjs';
assert.equal(process.getuid(),1001);
const {address}=await dns.lookup('arthello-188-225-38-55.sslip.io',{family:4});
const {server}=createRelay({bindAddress:address,schoolAddress:process.env.SCHOOL_IP},()=>net.createConnection({host:'mock-upstream',port:8443,allowHalfOpen:true}));
server.on('error',error=>{console.error(error.code);process.exit(1);});
server.listen({host:address,port:443,exclusive:true},()=>console.log('HOSTED_NONROOT_443_RELAY_READY'));
JS
cat > "$work/client.mjs" <<'JS'
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
const host='arthello-188-225-38-55.sslip.io';
assert.equal(process.getuid(),1001);
const {address}=await dns.lookup(host,{family:4});
assert.equal(address,process.env.RELAY_IP);
const result=await fetch('https://'+host+'/api/health',{signal:AbortSignal.timeout(10000)});
assert.equal(result.status,200);
assert.deepEqual(await result.json(),{status:'ok',path:'/api/health'});
// The School fixture has no direct DNS path into the mock egress network.
await assert.rejects(dns.lookup('mock-upstream'));
console.log('HOSTED_RELAY_DNS_TLS_ALLOWED_SOURCE=PASS');
JS
cat > "$work/rejected-client.mjs" <<'JS'
import assert from 'node:assert/strict';
await assert.rejects(fetch('https://arthello-188-225-38-55.sslip.io/api/health',{signal:AbortSignal.timeout(5000)}));
console.log('HOSTED_RELAY_OTHER_SOURCE_REJECTED=PASS');
JS
chmod 0755 "$work"
chmod 0444 "$work"/*
docker pull "$image" >/dev/null
docker network create --internal "$network_school" >/dev/null
docker network create --internal "$network_mock" >/dev/null
docker run -d --name "$school" --network "$network_school" \
  --user 1001:1001 --cap-drop ALL --security-opt no-new-privileges:true --read-only \
  --mount "type=bind,src=$work,dst=/fixtures,readonly" \
  -e NODE_EXTRA_CA_CERTS=/fixtures/mock.crt \
  "$image" node -e 'setInterval(()=>{},3600000)' >/dev/null
school_ip="$(docker inspect "$school" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')"
[[ "$school_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]
docker run -d --name "$upstream" --network "$network_mock" --network-alias mock-upstream \
  --user 1001:1001 --cap-drop ALL --security-opt no-new-privileges:true --read-only \
  --mount "type=bind,src=$work,dst=/fixtures,readonly" \
  "$image" node /fixtures/upstream.mjs >/dev/null
docker create --name "$relay" --network "$network_school" --network-alias "$hostname" \
  --user 1001:1001 --cap-drop ALL --security-opt no-new-privileges:true --read-only \
  --sysctl net.ipv4.ip_unprivileged_port_start=0 --sysctl net.ipv4.ip_forward=0 \
  --mount "type=bind,src=$work,dst=/fixtures,readonly" \
  --mount "type=bind,src=$(pwd)/deploy/school/sso-relay-r3/relay.mjs,dst=/relay/relay.mjs,readonly" \
  -e SCHOOL_IP="$school_ip" \
  "$image" node /fixtures/relay-fixture.mjs >/dev/null
docker network connect "$network_mock" "$relay"
docker start "$relay" >/dev/null
ready=0
for attempt in $(seq 1 30); do
  if docker logs "$relay" 2>&1 | grep -Fq HOSTED_NONROOT_443_RELAY_READY &&
    docker logs "$upstream" 2>&1 | grep -Fq MOCK_TLS_UPSTREAM_READY; then
    ready=1
    break
  fi
  sleep 1
done
test "$ready" -eq 1
relay_ip="$(docker inspect "$relay" --format "{{(index .NetworkSettings.Networks \"$network_school\").IPAddress}}")"
[[ "$relay_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]
docker inspect "$relay" | jq -e '
  .[0].Config.User=="1001:1001" and .[0].HostConfig.ReadonlyRootfs==true and
  .[0].HostConfig.CapDrop==["ALL"] and
  (.[0].HostConfig.SecurityOpt | index("no-new-privileges:true") != null) and
  .[0].HostConfig.Sysctls["net.ipv4.ip_unprivileged_port_start"]=="0" and
  .[0].HostConfig.Sysctls["net.ipv4.ip_forward"]=="0"
' >/dev/null
docker exec -e RELAY_IP="$relay_ip" "$school" node /fixtures/client.mjs
docker run --rm --network "$network_school" \
  --user 1001:1001 --cap-drop ALL --security-opt no-new-privileges:true --read-only \
  --mount "type=bind,src=$work,dst=/fixtures,readonly" \
  -e NODE_EXTRA_CA_CERTS=/fixtures/mock.crt \
  "$image" node /fixtures/rejected-client.mjs
printf 'SCHOOL_RELAY_R3_HOSTED_DOCKER_DNS_TLS_UID443_ACL=VERIFIED\n'
