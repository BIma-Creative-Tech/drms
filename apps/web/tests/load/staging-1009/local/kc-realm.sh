#!/bin/bash
# LOCAL THROWAWAY Keycloak realm for local/up.sh (never staging/prod). Runs INSIDE pk-lt1009-kc (start-dev) via
# `docker exec -i … bash`; up.sh prepends `declare -A PW=(…)` and ACCOUNTS on STDIN (passwords never in argv/env).
# Mirrors drms-staging after MC4-01: realm role pk-user in the scope mappings of proyekkas-mobile (password grant,
# ADR 0012) and proyekkas-web (code + PKCE); proyekkas-admin-api service account (view-users + manage-users).
# Users: admin.uji (bootstrap admin) + lt-* accounts, pk-user only, no required action, no OTP. lt-field-02..04 and
# lt-office-02/04/06..15 start DISABLED (= the deactivated E9/new accounts the app re-enables on staging).
set -euo pipefail
KC=/opt/keycloak/bin/kcadm.sh
R=${REALM:?}
$KC config credentials --server http://localhost:8080 --realm master --user lt-admin --password "$KC_ADMIN_PASSWORD" >/dev/null
if $KC get "realms/$R" >/dev/null 2>&1; then echo "realm $R exists"; exit 0; fi
$KC create realms -s realm="$R" -s enabled=true -s sslRequired=none -s accessTokenLifespan=300 -s revokeRefreshToken=false >/dev/null
$KC create roles -r "$R" -s name=pk-user >/dev/null
$KC create clients -r "$R" -f - >/dev/null <<JSON
{ "clientId": "proyekkas-admin-api", "publicClient": false, "secret": "$KC_SA_SECRET",
  "standardFlowEnabled": false, "directAccessGrantsEnabled": false, "serviceAccountsEnabled": true, "fullScopeAllowed": false }
JSON
$KC create clients -r "$R" -f - >/dev/null <<JSON
{ "clientId": "proyekkas-mobile", "publicClient": true, "standardFlowEnabled": false,
  "directAccessGrantsEnabled": true, "fullScopeAllowed": false, "attributes": { "use.refresh.tokens": "true" } }
JSON
$KC create clients -r "$R" -f - >/dev/null <<JSON
{ "clientId": "proyekkas-web", "publicClient": false, "secret": "$KC_WEB_SECRET", "standardFlowEnabled": true,
  "directAccessGrantsEnabled": false, "fullScopeAllowed": false, "redirectUris": ["$APP_URL/auth/callback"],
  "attributes": { "pkce.code.challenge.method": "S256", "post.logout.redirect.uris": "$APP_URL/*" } }
JSON
$KC add-roles -r "$R" --uusername service-account-proyekkas-admin-api --cclientid realm-management --rolename view-users --rolename manage-users
SA_ID=$($KC get clients -r "$R" -q clientId=proyekkas-admin-api --fields id --format csv --noquotes)
RM_ID=$($KC get clients -r "$R" -q clientId=realm-management --fields id --format csv --noquotes)
echo "[$($KC get "clients/$RM_ID/roles/view-users" -r "$R"),$($KC get "clients/$RM_ID/roles/manage-users" -r "$R")]" |
  $KC create "clients/$SA_ID/scope-mappings/clients/$RM_ID" -r "$R" -f - >/dev/null
for c in proyekkas-mobile proyekkas-web; do
  CID=$($KC get clients -r "$R" -q clientId=$c --fields id --format csv --noquotes)
  echo "[$($KC get roles/pk-user -r "$R")]" | $KC create "clients/$CID/scope-mappings/realm" -r "$R" -f - >/dev/null
done
for e in $ACCOUNTS; do
  enabled=true
  case "$e" in lt-field-0[234]@*|lt-office-0[24]@*|lt-office-0[6-9]@*|lt-office-1?@*) enabled=false ;; esac
  $KC create users -r "$R" -s username="$e" -s email="$e" -s enabled=$enabled -s emailVerified=true -s firstName=Uji -s lastName="${e%%@*}" >/dev/null
  $KC set-password -r "$R" --username "$e" --new-password "${PW[$e]:?no password for $e}"
  $KC add-roles -r "$R" --uusername "$e" --rolename pk-user
done
echo "realm $R ready"
