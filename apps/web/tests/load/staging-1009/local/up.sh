#!/bin/bash
# Staging load test 2026-10-09 — LOCAL THROWAWAY STACK to validate run.sh / fixture.mjs / mix.js / watchdog.sh
# without touching staging or prod. Never published ports; private network pk-lt1009-net; containers pk-lt1009-*.
#   postgres 16.15 · Keycloak 26.7.4 start-dev (realm drms-lt: same 3 clients + pk-user as drms-staging after MC4-01)
#   · the STAGING web image that runs tonight (0.6.2-stg-38d2be8, limits 384 MiB / 0.75 CPU like staging)
#   · migrate image of the same build for migrations + base seed (bootstrap admin = admin.uji, group admin, like the
#     seed path of plan §4 O-1b) + UAT seed (4 lt accounts with DRMS memberships = the E9 state of staging).
# Usage: LT_LOCAL_WORK=<scratch dir outside git> local/up.sh      (then local/validate.sh, local/down.sh)
# Secrets (DB/KC passwords, account passwords) are generated into LT_LOCAL_WORK (700/600) and never printed.
set -euo pipefail
W=${LT_LOCAL_WORK:?LT_LOCAL_WORK scratch dir required}
HERE=$(cd "$(dirname "$0")" && pwd)
P=pk-lt1009
NET=$P-net
REALM=drms-lt
APP_URL=http://$P-web:3000
WEB_IMG=${LT_LOCAL_WEB_IMG:-ghcr.io/bctech-adm/proyekkas-web@sha256:b34b27f61372794b748de5e0e8b4bb0a4f774253a28f92759f2d7fbdb9e40c72}
MIG_IMG=${LT_LOCAL_MIG_IMG:-ghcr.io/bctech-adm/proyekkas-migrate@sha256:8fddd0dcc54652dbfa140fa72e579f31340427bf51caa7832a768440ddc97edb}
PG_IMG=postgres:16.15-bookworm
KC_IMG=quay.io/keycloak/keycloak:26.7.4
HARDEN=(--cap-drop ALL --security-opt no-new-privileges:true)
install -d -m 700 "$W" "$W/out"
install -d -m 755 "$W/media"
chown 1001:1001 "$W/media"
ENVF=$W/local.env
PW=$W/pw.csv
# local roster: admin + lt-field-01..04 + all 15 office accounts (the 3 projects need Direktur 03/10 + PM 05/14/15)
ACCOUNTS="admin.uji@proyekkas.test $(for i in 01 02 03 04; do printf 'lt-field-%s@proyekkas.test ' $i; done)$(for i in $(seq -w 1 15); do printf 'lt-office-%s@proyekkas.test ' $i; done)"
gen() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

umask 077
if [ ! -f "$ENVF" ]; then
  { echo "PG_SU_PW=$(gen)"; echo "OWNER_PW=$(gen)"; echo "APP_PW=$(gen)"; echo "KC_ADMIN_PW=$(gen)"; echo "KC_SA_SECRET=$(gen)"; echo "KC_WEB_SECRET=$(gen)"; echo "PAYLOAD_SECRET=$(gen)$(gen)"; } > "$ENVF"
fi
[ -f "$PW" ] || { echo "email,password"; for a in $ACCOUNTS; do echo "$a,Lt-$(gen | cut -c1-22)"; done; } > "$PW"
chmod 600 "$ENVF" "$PW"
set -a
# shellcheck disable=SC1090
. "$ENVF"
set +a

docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null

# ---- postgres
if ! docker inspect "$P-pg" >/dev/null 2>&1; then
  docker run -d --name "$P-pg" --network "$NET" --memory 512m --cpus 1 --security-opt no-new-privileges:true \
    -e POSTGRES_PASSWORD="$PG_SU_PW" "$PG_IMG" postgres -c shared_buffers=64MB -c max_connections=60 >/dev/null
fi
for _ in $(seq 60); do docker exec "$P-pg" pg_isready -U postgres -q 2>/dev/null && break; sleep 1; done
sleep 2
if ! docker exec "$P-pg" psql -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='pk_lt_owner'" | grep -q 1; then
  docker exec -i -e OWNER_PW -e APP_PW "$P-pg" bash -c 'psql -q -v ON_ERROR_STOP=1 -U postgres -v owner_pw="$OWNER_PW" -v app_pw="$APP_PW"' <<'SQL'
CREATE ROLE pk_lt_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 4;
CREATE ROLE pk_lt_app   LOGIN PASSWORD :'app_pw'   NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 30;
CREATE DATABASE pk_lt OWNER pk_lt_owner;
REVOKE ALL ON DATABASE pk_lt FROM PUBLIC;
GRANT CONNECT ON DATABASE pk_lt TO pk_lt_app;
\connect pk_lt
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO pk_lt_owner;
GRANT USAGE ON SCHEMA public TO pk_lt_app;
SQL
fi
echo "pg ready"

# ---- keycloak
if ! docker inspect "$P-kc" >/dev/null 2>&1; then
  docker run -d --name "$P-kc" --network "$NET" --memory 768m --cpus 1.5 "${HARDEN[@]}" \
    -e KC_BOOTSTRAP_ADMIN_USERNAME=lt-admin -e KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_ADMIN_PW" \
    -e JAVA_OPTS_KC_HEAP="-XX:MaxRAMPercentage=50 -XX:InitialRAMPercentage=10" "$KC_IMG" start-dev --health-enabled=true >/dev/null
fi
for _ in $(seq 120); do docker exec "$P-kc" bash -c 'exec 3<>/dev/tcp/127.0.0.1/9000 && printf "GET /health/ready HTTP/1.0\r\n\r\n" >&3 && grep -q UP <&3' 2>/dev/null && break; sleep 2; done
{ echo 'declare -A PW'; tail -n +2 "$PW" | while IFS=, read -r e p; do printf 'PW[%q]=%q\n' "$e" "$p"; done; echo "ACCOUNTS='$ACCOUNTS'"; cat "$HERE/kc-realm.sh"; } |
  docker exec -i -e KC_ADMIN_PASSWORD="$KC_ADMIN_PW" -e KC_SA_SECRET -e KC_WEB_SECRET -e REALM="$REALM" -e APP_URL="$APP_URL" "$P-kc" bash
kcsub() { docker exec -e KC_ADMIN_PW "$P-kc" bash -c '/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user lt-admin --password "$KC_ADMIN_PW" >/dev/null && /opt/keycloak/bin/kcadm.sh get users -r '"$REALM"' -q email='"$1"' -q exact=true --fields id --format csv --noquotes'; }

# ---- app env (600)
cat > "$W/app.env" <<EOF
NODE_ENV=production
TZ=Asia/Makassar
NEXT_TELEMETRY_DISABLED=1
DATABASE_URL=postgres://pk_lt_app:$APP_PW@$P-pg:5432/pk_lt
DATABASE_POOL_MAX=5
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
chmod 600 "$W/app.env"

# ---- migrations (owner role) + base seed (admin.uji = bootstrap group admin) + UAT seed (E9-like lt accounts in DRMS)
if [ ! -f "$W/seeded" ]; then
  ADMIN_SUB=$(kcsub admin.uji@proyekkas.test)
  uat="["
  for pair in "lt-field-01@proyekkas.test:pk-staff:Uji Beban field 01" "lt-office-05@proyekkas.test:pk-pm:Uji Beban office 05" "lt-office-01@proyekkas.test:pk-finance:Uji Beban office 01" "lt-office-03@proyekkas.test:pk-owner:Uji Beban office 03"; do
    IFS=: read -r e r n <<<"$pair"
    uat="$uat{\"email\":\"$e\",\"name\":\"$n\",\"role\":\"$r\",\"keycloakSub\":\"$(kcsub "$e")\"},"
  done
  uat="${uat%,}]"
  OWNER_URL="postgres://pk_lt_owner:$OWNER_PW@$P-pg:5432/pk_lt"
  docker run --rm --name "$P-migrate" --network "$NET" --memory 1536m --cpus 1.5 "${HARDEN[@]}" --env-file "$W/app.env" \
    -e DATABASE_URL="$OWNER_URL" "$MIG_IMG" node /app/node_modules/payload/bin.js migrate > "$W/out/migrate.log" 2>&1
  docker run --rm --name "$P-migrate" --network "$NET" --memory 1536m --cpus 1.5 "${HARDEN[@]}" --env-file "$W/app.env" -v "$W/media:/data/media" \
    -e SEED_ADMIN_EMAIL=admin.uji@proyekkas.test -e SEED_ADMIN_KEYCLOAK_SUB="$ADMIN_SUB" "$MIG_IMG" node /app/node_modules/payload/bin.js run src/seed/index.ts > "$W/out/seed.log" 2>&1
  docker run --rm --name "$P-migrate" --network "$NET" --memory 1536m --cpus 1.5 "${HARDEN[@]}" --env-file "$W/app.env" -v "$W/media:/data/media" \
    -e UAT_USERS="$uat" "$MIG_IMG" node /app/node_modules/payload/bin.js run src/seed/uat.ts > "$W/out/seed-uat.log" 2>&1
  touch "$W/seeded"
  echo "migrate + seed ok"
fi

# ---- web (staging image, staging limits)
if ! docker inspect "$P-web" >/dev/null 2>&1; then
  docker run -d --name "$P-web" --network "$NET" --memory 384m --cpus 0.75 "${HARDEN[@]}" --env-file "$W/app.env" \
    -e NODE_OPTIONS=--max-old-space-size=256 -v "$W/media:/data/media" "$WEB_IMG" >/dev/null
fi
for _ in $(seq 60); do
  docker exec "$P-web" node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && { echo "web ready $APP_URL"; exit 0; }
  sleep 2
done
docker logs --tail 40 "$P-web"
exit 1
