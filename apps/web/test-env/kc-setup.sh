#!/bin/bash
# THROWAWAY realm pk-f1 in pk-f1-keycloak (dev mode) for tests/kc/keycloak-admin.kc.test.ts.
# Mirrors the live realm export for proyekkas-admin-api (runbook: fullScopeAllowed=false + explicit
# scope mapping + service-account roles realm-management view-users/manage-users).
# Usage: docker exec -i -e KC_ADMIN_PASSWORD -e KC_SA_SECRET -e KC_USER_PASSWORD -e KC_WEB_SECRET pk-f1-keycloak bash < kc-setup.sh
# ADR 0017 (tests/kc/two-factor.kc.test.ts): the realm keeps Keycloak's DEFAULT flows — the same
# structure as the drms exports (browser "Conditional 2FA", direct grant "Conditional OTP",
# CONFIGURE_TOTP + delete_credential enabled, not default) — plus a TEST-ONLY confidential web client.
set -euo pipefail
KC=/opt/keycloak/bin/kcadm.sh
R=pk-f1
$KC config credentials --server http://localhost:8080 --realm master --user pk-f1-admin --password "$KC_ADMIN_PASSWORD" >/dev/null
$KC create realms -s realm=$R -s enabled=true -s accessTokenLifespan=300 -s revokeRefreshToken=true >/dev/null
for r in pk-staff pk-pm pk-finance pk-owner pk-admin; do $KC create roles -r $R -s name=$r >/dev/null; done

$KC create clients -r $R -f - >/dev/null <<JSON
{ "clientId": "proyekkas-admin-api", "publicClient": false, "secret": "$KC_SA_SECRET",
  "standardFlowEnabled": false, "directAccessGrantsEnabled": false, "serviceAccountsEnabled": true,
  "fullScopeAllowed": false }
JSON
# TEST-ONLY public client with password grant, to create online/offline sessions without a browser
$KC create clients -r $R -f - >/dev/null <<JSON
{ "clientId": "proyekkas-mobile", "publicClient": true, "standardFlowEnabled": false,
  "directAccessGrantsEnabled": true, "attributes": { "use.refresh.tokens": "true" } }
JSON
# TEST-ONLY confidential web client (Authorization Code + PKCE); the redirect URI is never fetched
$KC create clients -r $R -f - >/dev/null <<JSON
{ "clientId": "proyekkas-web", "publicClient": false, "secret": "$KC_WEB_SECRET", "standardFlowEnabled": true,
  "directAccessGrantsEnabled": false, "redirectUris": ["http://app.pk-f1.test/auth/callback"],
  "attributes": { "pkce.code.challenge.method": "S256" } }
JSON
$KC add-roles -r $R --uusername service-account-proyekkas-admin-api --cclientid realm-management --rolename view-users --rolename manage-users
SA_ID=$($KC get clients -r $R -q clientId=proyekkas-admin-api --fields id --format csv --noquotes)
RM_ID=$($KC get clients -r $R -q clientId=realm-management --fields id --format csv --noquotes)
ROLES="$($KC get clients/$RM_ID/roles/view-users -r $R),$($KC get clients/$RM_ID/roles/manage-users -r $R)"
echo "[$ROLES]" | $KC create clients/$SA_ID/scope-mappings/clients/$RM_ID -r $R -f -

$KC create users -r $R -s username=kc.session -s enabled=true -s emailVerified=true -s email=kc.session@drms.test -s firstName=Kc -s lastName=Session >/dev/null
$KC set-password -r $R --username kc.session --new-password "$KC_USER_PASSWORD"
$KC add-roles -r $R --uusername kc.session --rolename pk-staff
$KC create users -r $R -s username=kc.tfa@drms.test -s enabled=true -s emailVerified=true -s email=kc.tfa@drms.test -s firstName=Kc -s lastName=Tfa >/dev/null
$KC set-password -r $R --username kc.tfa@drms.test --new-password "$KC_USER_PASSWORD"
echo "realm $R ready"
