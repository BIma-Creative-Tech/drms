/**
 * Digital Asset Links statement list for Android App Links (`/.well-known/assetlinks.json`):
 * lets the APK claim `https://<pk-host>/app/callback` as its OIDC redirect (ADR 0003 §1, ADR 0010
 * decision 3). Pure module. Without configured certificate fingerprints the list is EMPTY (`[]`):
 * a statement without fingerprints can never verify, and an empty list is the valid "no
 * statements" document — App Link verification then fails closed (the APK falls back to its
 * private-use scheme redirect, ADR 0010).
 */
export type AssetStatement = {
  relation: string[]
  target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] }
}

export function assetLinks(packageName: string, fingerprints: string[]): AssetStatement[] {
  if (fingerprints.length === 0) return []
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: fingerprints },
    },
  ]
}
