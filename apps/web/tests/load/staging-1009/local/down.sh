#!/bin/bash
# Removes the LOCAL throwaway stack of local/up.sh by exact container / network names (never a prune).
# The scratch dir LT_LOCAL_WORK (secrets, media, results) is left to the caller (delete it with your own tooling).
set -uo pipefail
P=pk-lt1009
for c in k6 zap fixture migrate web kc pg; do
  docker inspect "$P-$c" >/dev/null 2>&1 && docker rm -f "$P-$c" >/dev/null && echo "removed $P-$c"
done
docker network inspect "$P-net" >/dev/null 2>&1 && docker network rm "$P-net" >/dev/null && echo "removed $P-net"
exit 0
