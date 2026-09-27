#!/usr/bin/env bash
# Static secret scan of built APKs — F4 acceptance gate "no secrets in APK (static scan)".
# 1. tool/apk_extract_text.py: unpack every entry; binaries (dex, Dart AOT libapp.so, arsc) as
#    printable-string dumps; signing material / google-services.json inside the APK = failure.
# 2. Deny-list: names/markers of server-side secrets that must never reach the APK.
# 3. gitleaks (default rules + tool/apk-gitleaks.toml allowlist of verified library constants) and trivy (secret scanner) on the unpacked tree — the same pinned
#    images as .github/workflows/ci.yml.
# Usage: tool/apk_secret_scan.sh APK [APK ...]   (needs python3 + docker; SCAN_DIR optional)
set -euo pipefail
[ "$#" -ge 1 ] || { echo "usage: $0 APK [APK ...]" >&2; exit 64; }
here="$(cd "$(dirname "$0")" && pwd)"
scan="${SCAN_DIR:-$(mktemp -d)}"
mkdir -p "$scan"
fail=0

python3 "$here/apk_extract_text.py" "$scan" "$@" || { echo "::error::forbidden file inside the APK"; fail=1; }

# Values of these exist only on the server / in CI secrets. Private-key blocks never belong in an APK.
deny='BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY|"private_key_id"|OIDC_WEB_CLIENT_SECRET|KC_ADMIN_CLIENT_SECRET|PAYLOAD_SECRET|DATABASE_URL|SMTP_PASSWORD|FCM_SERVICE_ACCOUNT|ANDROID_KEYSTORE_PASSWORD|ANDROID_KEY_PASSWORD|proyekkas-admin-api'
if grep -rIlE "$deny" "$scan"; then
  echo "::error::server-side secret name / private key marker found in the APK (files above)"
  fail=1
fi

docker run --rm -v "$scan:/scan:ro" -v "$here/apk-gitleaks.toml:/cfg/gitleaks.toml:ro" \
  zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f \
  dir --no-banner --redact --exit-code 1 --config /cfg/gitleaks.toml /scan || { echo "::error::gitleaks found secrets in the APK"; fail=1; }

docker run --rm -v "$scan:/scan:ro" \
  aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969 \
  fs --scanners secret --exit-code 1 --quiet /scan || { echo "::error::trivy found secrets in the APK"; fail=1; }

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "APK secret scan: clean ($*)"
