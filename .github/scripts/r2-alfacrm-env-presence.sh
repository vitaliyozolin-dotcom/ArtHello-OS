#!/usr/bin/env bash
# Read-only presence flags. Raw environment and credential values never leave
# the local pipe and are never stored or printed.
set -Eeuo pipefail
case "${1:-}" in
  --current-arthello)
    target="${2:-}"
    [[ "$target" =~ ^[a-f0-9]{12,64}$ ]]
    scope=current-arthello
    ;;
  --school-legacy)
    scope=legacy-arthello-os-api-on-school-host
    mapfile -t identities < <(docker ps --filter 'name=^/arthello-os-api$' --format '{{.ID}}')
    if [ "${#identities[@]}" -eq 0 ]; then
      printf '{"scope":"legacy-arthello-os-api-on-school-host","targetPresent":false}\n'
      exit 0
    fi
    test "${#identities[@]}" -eq 1
    target="${identities[0]}"
    [[ "$target" =~ ^[a-f0-9]{12,64}$ ]]
    test "$(docker inspect "$target" --format '{{.Name}}')" = /arthello-os-api
    ;;
  *) exit 2 ;;
esac
docker inspect "$target" --format '{{json .Config.Env}}' | python3 -I -c '
import json,sys
keys=("ALFACRM_DOMAIN","ALFACRM_EMAIL","ALFACRM_API_KEY")
values=json.load(sys.stdin)
assert isinstance(values,list) and all(isinstance(item,str) for item in values)
flags={name:False for name in keys}
for item in values:
    name,separator,value=item.partition("=")
    if separator and name in flags:
        flags[name]=flags[name] or bool(value.strip())
print(json.dumps({"scope":sys.argv[1],"targetPresent":True,**flags},sort_keys=True))
' "$scope"
