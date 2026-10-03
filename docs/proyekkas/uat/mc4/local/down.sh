#!/bin/bash
# MC4 UAT suite — removes the LOCAL throwaway stack by exact container / network names (never a prune).
#   UAT_PREFIX (default pk-mc4uat2). The scratch dir UAT_WORK (secrets, media, results) is left to the caller.
set -uo pipefail
P=${UAT_PREFIX:-pk-mc4uat2}
for c in web kc pg node runner pw fixture api check; do
  docker inspect "$P-$c" >/dev/null 2>&1 && docker rm -f "$P-$c" >/dev/null && echo "removed $P-$c"
done
docker network inspect "$P-net" >/dev/null 2>&1 && docker network rm "$P-net" >/dev/null && echo "removed $P-net"
exit 0
