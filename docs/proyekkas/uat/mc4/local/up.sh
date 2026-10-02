#!/bin/bash
# MC4 UAT suite — LOCAL THROWAWAY stack to validate the suite (never staging/prod, no published ports).
#   postgres 16.15 + Keycloak 26.7.4 (start-dev, realm from kc-realm.sh) + this worktree's app
#   (next standalone build, node 24.21.0) on a private docker network; containers <prefix>-*.
# Usage (repo root):  UAT_WORK=/path/outside/repo docs/proyekkas/uat/mc4/local/up.sh [build|db|kc|web|seed|all]
#   UAT_WORK  scratch dir (mode 700): throwaway secrets (local.env), passwords (pw/<email>), media, outputs
#   UAT_PREFIX container/network prefix (default pk-mc4uat2)
# Steps of "all": secrets → network → pg → kc (+ realm) → build (skipped when the standalone build exists,
# REBUILD=1 forces) → migrate (owner role) + base seed (bootstrap admin) + UAT seed (DRMS uji accounts) → web.
# RAM: pg 512m, kc 768m, web 640m, toolbox 2.5g (build/migrate only; stopped afterwards). One heavy step at a time.
set -euo pipefail
: "${UAT_WORK:?set UAT_WORK to a scratch dir outside the repo}"
REPO=$(cd "$(dirname "$0")/../../../../.." && pwd)
P=${UAT_PREFIX:-pk-mc4uat2}
NET=$P-net
REALM=drms-uat
APP_URL=http://$P-web:3000
NODE_IMG=node:24.21.0-bookworm-slim
PG_IMG=postgres:16.15-bookworm
KC_IMG=quay.io/keycloak/keycloak:26.7.4
HARDEN=(--cap-drop ALL --security-opt no-new-privileges:true)
mkdir -p "$UAT_WORK/pw" "$UAT_WORK/media" "$UAT_WORK/out"
chmod 700 "$UAT_WORK" "$UAT_WORK/pw"
ENVF=$UAT_WORK/local.env
ACCOUNTS="pemilik.lokal@drms.test staff.uji@proyekkas.test pm.uji@proyekkas.test finance.uji@proyekkas.test owner.uji@proyekkas.test admin.uji@proyekkas.test staff-cs1.uji@proyekkas.test pm-cs1.uji@proyekkas.test dir-cs1.uji@proyekkas.test rina.uji@proyekkas.test andi.uji@proyekkas.test"

gen() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
secrets() {
  umask 077
  if [ ! -f "$ENVF" ]; then
    {
      echo "PG_SU_PW=$(gen)"; echo "OWNER_PW=$(gen)"; echo "APP_PW=$(gen)"; echo "RO_PW=$(gen)"
      echo "KC_ADMIN_PW=$(gen)"; echo "KC_SA_SECRET=$(gen)"; echo "KC_WEB_SECRET=$(gen)"; echo "PAYLOAD_SECRET=$(gen)$(gen)"
    } > "$ENVF"
  fi
  for a in $ACCOUNTS; do [ -f "$UAT_WORK/pw/$a" ] || echo "Uji-$(gen | cut -c1-20)" > "$UAT_WORK/pw/$a"; done
  chmod 600 "$ENVF" "$UAT_WORK"/pw/*
}
# shellcheck disable=SC1090
load() { set -a; . "$ENVF"; set +a; }

net() { docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null; }

pg() {
  load
  if ! docker inspect "$P-pg" >/dev/null 2>&1; then
    docker run -d --name "$P-pg" --network "$NET" --memory 512m --cpus 1 --security-opt no-new-privileges:true \
      -e POSTGRES_PASSWORD="$PG_SU_PW" "$PG_IMG" postgres -c shared_buffers=64MB -c max_connections=60 >/dev/null
  fi
  for _ in $(seq 60); do docker exec "$P-pg" pg_isready -U postgres -q 2>/dev/null && break; sleep 1; done
  sleep 2
  if ! docker exec "$P-pg" psql -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='pk_uat_owner'" | grep -q 1; then
    docker exec -i -e OWNER_PW -e APP_PW -e RO_PW "$P-pg" bash -c 'psql -v ON_ERROR_STOP=1 -U postgres -v owner_pw="$OWNER_PW" -v app_pw="$APP_PW" -v ro_pw="$RO_PW"' <<'SQL' >/dev/null
CREATE ROLE pk_uat_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
CREATE ROLE pk_uat_app   LOGIN PASSWORD :'app_pw'   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 30;
CREATE ROLE pk_uat_ro    LOGIN PASSWORD :'ro_pw'    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3;
CREATE DATABASE pk_uat OWNER pk_uat_owner;
REVOKE ALL ON DATABASE pk_uat FROM PUBLIC;
GRANT CONNECT ON DATABASE pk_uat TO pk_uat_app, pk_uat_ro;
\connect pk_uat
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO pk_uat_owner;
GRANT USAGE ON SCHEMA public TO pk_uat_app, pk_uat_ro;
SQL
  fi
  echo "pg ready"
}

kc() {
  load
  if ! docker inspect "$P-kc" >/dev/null 2>&1; then
    docker run -d --name "$P-kc" --network "$NET" --memory 768m --cpus 1.5 "${HARDEN[@]}" \
      -e KC_BOOTSTRAP_ADMIN_USERNAME=uat-admin -e KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_ADMIN_PW" \
      -e JAVA_OPTS_KC_HEAP="-XX:MaxRAMPercentage=50 -XX:InitialRAMPercentage=10" \
      "$KC_IMG" start-dev --health-enabled=true >/dev/null
  fi
  for _ in $(seq 120); do docker exec "$P-kc" bash -c 'exec 3<>/dev/tcp/127.0.0.1/9000 && printf "GET /health/ready HTTP/1.0\r\n\r\n" >&3 && grep -q UP <&3' 2>/dev/null && break; sleep 2; done
  { echo 'declare -A PW'; for a in $ACCOUNTS; do printf 'PW[%q]=%q\n' "$a" "$(cat "$UAT_WORK/pw/$a")"; done; cat "$REPO/docs/proyekkas/uat/mc4/local/kc-realm.sh"; } |
    docker exec -i -e KC_ADMIN_PASSWORD="$KC_ADMIN_PW" -e KC_SA_SECRET -e KC_WEB_SECRET -e REALM="$REALM" -e APP_URL="$APP_URL" "$P-kc" bash
}

appenv() { # env file for the app (toolbox + web), written to UAT_WORK (600)
  load
  umask 077
  cat > "$UAT_WORK/app.env" <<EOF
NODE_ENV=production
TZ=Asia/Makassar
NEXT_TELEMETRY_DISABLED=1
DATABASE_URL=postgres://pk_uat_app:$APP_PW@$P-pg:5432/pk_uat
DATABASE_POOL_MAX=8
PAYLOAD_SECRET=$PAYLOAD_SECRET
APP_URL=$APP_URL
OIDC_ISSUER=http://$P-kc:8080/realms/$REALM
OIDC_WEB_CLIENT_ID=proyekkas-web
OIDC_WEB_CLIENT_SECRET=$KC_WEB_SECRET
OIDC_MOBILE_CLIENT_ID=proyekkas-mobile
KC_ADMIN_BASE_URL=http://$P-kc:8080
KC_ADMIN_CLIENT_SECRET=$KC_SA_SECRET
AUTH_COOKIE_INSECURE=true
MEDIA_DIR=/data/media
LOG_LEVEL=warn
EOF
}

toolbox() {
  if ! docker inspect "$P-node" >/dev/null 2>&1; then
    docker run -d --name "$P-node" --network "$NET" --memory 2560m --cpus 2 "${HARDEN[@]}" -e NEXT_TELEMETRY_DISABLED=1 -e TZ=Asia/Makassar \
      -v "$REPO:/work" -v "$UAT_WORK:/uatwork" -w /work "$NODE_IMG" sleep infinity >/dev/null
  fi
}

build() {
  toolbox
  if [ -f "$REPO/apps/web/.next/standalone/apps/web/server.js" ] && [ "${REBUILD:-0}" != 1 ]; then echo "build exists (REBUILD=1 to force)"; return; fi
  docker exec "$P-node" sh -c 'cd /work && ([ -d node_modules ] || npm ci --no-audit --no-fund) && cd apps/web && PAYLOAD_SECRET=build-time-placeholder-not-a-secret-0000 DATABASE_URL=postgres://build:build@127.0.0.1:1/build NODE_OPTIONS=--max-old-space-size=1280 npm run build'
}

seed() {
  appenv; toolbox
  local sub
  kcsub() { docker exec -e KC_ADMIN_PW "$P-kc" bash -c '/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user uat-admin --password "$KC_ADMIN_PW" >/dev/null && /opt/keycloak/bin/kcadm.sh get users -r '"$REALM"' -q email='"$1"' -q exact=true --fields id --format csv --noquotes'; }
  sub=$(kcsub pemilik.lokal@drms.test)
  local uat="["
  for pair in "staff.uji@proyekkas.test:pk-staff:Staff Uji" "pm.uji@proyekkas.test:pk-pm:PM Uji" "finance.uji@proyekkas.test:pk-finance:Finance Uji" "owner.uji@proyekkas.test:pk-owner:Owner Uji"; do
    IFS=: read -r e r n <<<"$pair"
    uat="$uat{\"email\":\"$e\",\"name\":\"$n\",\"role\":\"$r\",\"keycloakSub\":\"$(kcsub "$e")\"},"
  done
  uat="${uat%,}]"
  # migrations as the OWNER role (ADR 0006), seeds as the APP role
  docker exec -e UAT_USERS="$uat" -e SEED_ADMIN_EMAIL=pemilik.lokal@drms.test -e SEED_ADMIN_KEYCLOAK_SUB="$sub" "$P-node" sh -c '
    set -e; set -a; . /uatwork/app.env; set +a; cd /work/apps/web
    APP_URL_DB=$DATABASE_URL
    . /uatwork/local.env; DATABASE_URL=$(echo "$APP_URL_DB" | sed "s#pk_uat_app:[^@]*@#pk_uat_owner:$OWNER_PW@#") npx payload migrate >/uatwork/out/migrate.log 2>&1
    DATABASE_URL=$APP_URL_DB npx payload run src/seed/index.ts >/uatwork/out/seed.log 2>&1
    DATABASE_URL=$APP_URL_DB npx payload run src/seed/uat.ts >/uatwork/out/seed-uat.log 2>&1
    echo migrate+seed ok'
}

web() {
  appenv
  docker rm -f "$P-web" >/dev/null 2>&1 || true
  # standalone output + static assets (copied next to server.js, as the Dockerfile does)
  rm -rf "$REPO/apps/web/.next/standalone/apps/web/.next/static"
  cp -r "$REPO/apps/web/.next/static" "$REPO/apps/web/.next/standalone/apps/web/.next/static"
  docker run -d --name "$P-web" --network "$NET" --memory 640m --cpus 1 "${HARDEN[@]}" --env-file "$UAT_WORK/app.env" \
    -e HOSTNAME=0.0.0.0 -e PORT=3000 -e NODE_OPTIONS=--max-old-space-size=384 \
    -v "$REPO/apps/web/.next/standalone:/app" -v "$UAT_WORK/media:/data/media" -w /app "$NODE_IMG" node apps/web/server.js >/dev/null
  for _ in $(seq 60); do
    docker exec "$P-web" node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && { echo "web ready $APP_URL"; return; }
    sleep 2
  done
  docker logs --tail 40 "$P-web"; exit 1
}

case "${1:-all}" in
  secrets) secrets ;;
  build) net; build ;;
  db) secrets; net; pg ;;
  kc) secrets; net; kc ;;
  seed) seed ;;
  web) web ;;
  all) secrets; net; pg; kc; build; seed; docker stop "$P-node" >/dev/null; web ;;
  *) echo "usage: up.sh [secrets|build|db|kc|seed|web|all]"; exit 2 ;;
esac
