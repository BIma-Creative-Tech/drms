#!/bin/bash
# MC4 UAT suite — LOCAL THROWAWAY Keycloak realm (never staging/prod). Runs INSIDE the throwaway
# container <prefix>-kc (start-dev) via `docker exec -i ... bash < kc-realm.sh` (see up.sh).
# Mirrors what the suite needs from realm drms-staging AFTER MC4-01 is fixed:
#   - realm roles pk-user (login marker, ADR 0016 §2) + the legacy pk-staff/pm/finance/owner/admin
#   - proyekkas-mobile: public, password grant (ADR 0012), fullScopeAllowed=false, scope mapping incl. pk-user
#   - proyekkas-web: confidential, code + PKCE S256, fullScopeAllowed=false, scope mapping incl. pk-user
#   - proyekkas-admin-api: service account with realm-management view-users + manage-users
#   - users: the owner's own admin (bootstrap = group admin), the 4 existing UAT accounts of DRMS and
#     the 6 MC4 fictional accounts, all with realm role pk-user ONLY (= the MC4-01 regression case)
# Env (passed with docker exec -e): KC_ADMIN_PASSWORD, KC_SA_SECRET, KC_WEB_SECRET, REALM, APP_URL.
# Passwords: up.sh prepends `declare -A PW=([<email>]=<password> …)` to this script on STDIN (never argv/env).
set -euo pipefail
KC=/opt/keycloak/bin/kcadm.sh
R=${REALM:?}
$KC config credentials --server http://localhost:8080 --realm master --user uat-admin --password "$KC_ADMIN_PASSWORD" >/dev/null
if $KC get "realms/$R" >/dev/null 2>&1; then echo "realm $R exists"; exit 0; fi
$KC create realms -s realm="$R" -s enabled=true -s sslRequired=none -s accessTokenLifespan=300 -s revokeRefreshToken=false >/dev/null
for r in pk-user pk-staff pk-pm pk-finance pk-owner pk-admin; do $KC create roles -r "$R" -s name=$r >/dev/null; done

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
ROLES="$($KC get "clients/$RM_ID/roles/view-users" -r "$R"),$($KC get "clients/$RM_ID/roles/manage-users" -r "$R")"
echo "[$ROLES]" | $KC create "clients/$SA_ID/scope-mappings/clients/$RM_ID" -r "$R" -f - >/dev/null

# MC4-01 FIXED state: pk-user (and the legacy roles) in the realm scope mappings of both app clients
REALM_ROLES=""
for r in pk-user pk-staff pk-pm pk-finance pk-owner pk-admin; do REALM_ROLES="${REALM_ROLES:+$REALM_ROLES,}$($KC get "roles/$r" -r "$R")"; done
REALM_ROLES="[$REALM_ROLES]"
for c in proyekkas-mobile proyekkas-web; do
  CID=$($KC get clients -r "$R" -q clientId=$c --fields id --format csv --noquotes)
  echo "$REALM_ROLES" | $KC create "clients/$CID/scope-mappings/realm" -r "$R" -f - >/dev/null
done

user() { # email first last
  $KC create users -r "$R" -s username="$1" -s email="$1" -s enabled=true -s emailVerified=true -s firstName="$2" -s lastName="$3" >/dev/null
  $KC set-password -r "$R" --username "$1" --new-password "${PW[$1]:?no password for $1}"
  $KC add-roles -r "$R" --uusername "$1" --rolename pk-user
}
user pemilik.lokal@drms.test Pemilik Lokal
user staff.uji@proyekkas.test Staff Uji
user pm.uji@proyekkas.test PM Uji
user finance.uji@proyekkas.test Finance Uji
user owner.uji@proyekkas.test Owner Uji
user admin.uji@proyekkas.test Admin Uji
user staff-cs1.uji@proyekkas.test Staff CS1
user pm-cs1.uji@proyekkas.test PM CS1
user dir-cs1.uji@proyekkas.test Direktur CS1
user rina.uji@proyekkas.test Rina Uji
user andi.uji@proyekkas.test Andi Uji
echo "realm $R ready"
