// MC4 QA — LOCAL THROWAWAY load-test identity provider (docs/proyekkas/qa/mc4-qa-report.md §Perf).
// NEVER deploy: it signs an access token for ANY username without a password. It exists so the
// unchanged Q-34 k6 mix (tests/load/q34-mix.js MODE=auth: password grant + refresh) can drive a local
// `next start` whose OIDC_ISSUER points here; the app verifies the RS256 signature via JWKS exactly as
// with Keycloak (azp proyekkas-mobile, typ Bearer, realm role pk-user). Runs only inside the private
// docker network of the throwaway stack (no published port).
//   node fake-idp.mjs            (env ISSUER=http://<host>:8080/realms/<realm>, PORT=8080)
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

import { exportJWK, generateKeyPair, SignJWT } from 'jose'

const ISSUER = process.env.ISSUER ?? 'http://pk-mc4qa-idp:8080/realms/drms-perf'
const PORT = Number(process.env.PORT ?? 8080)
const TTL = Number(process.env.TOKEN_TTL ?? 300)
const path = new URL(ISSUER).pathname
const { publicKey, privateKey } = await generateKeyPair('RS256')
const kid = randomUUID()
const jwks = JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }] })

async function token(sub) {
  const now = Math.floor(Date.now() / 1000)
  const at = await new SignJWT({ typ: 'Bearer', azp: 'proyekkas-mobile', sid: randomUUID(), realm_access: { roles: ['pk-user'] }, scope: 'openid' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(ISSUER)
    .setSubject(sub)
    .setIssuedAt(now)
    .setExpirationTime(now + TTL)
    .sign(privateKey)
  return JSON.stringify({ access_token: at, expires_in: TTL, refresh_token: Buffer.from(sub).toString('base64url'), refresh_expires_in: 1800, token_type: 'Bearer' })
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  if (req.method === 'GET' && url.pathname === `${path}/protocol/openid-connect/certs`) {
    res.writeHead(200, { 'content-type': 'application/json' }).end(jwks)
    return
  }
  if (req.method === 'POST' && url.pathname === `${path}/protocol/openid-connect/token`) {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      const f = new URLSearchParams(body)
      const sub = f.get('grant_type') === 'refresh_token' ? Buffer.from(f.get('refresh_token') ?? '', 'base64url').toString() : f.get('username')
      if (!sub || !/^[a-z0-9.-]{1,64}$/.test(sub)) {
        res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"invalid_grant"}')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(await token(sub))
    })
    return
  }
  res.writeHead(404).end()
}).listen(PORT, '0.0.0.0', () => console.log(`fake idp ${ISSUER} on :${PORT}`))
