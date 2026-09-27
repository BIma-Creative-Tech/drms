import { relId, userRoles } from '@/access/roles'

import { json, v1 } from '../http'

type UserShape = {
  id: number
  email: string
  name?: string | null
  employee?: unknown
  _strategy?: 'oidcSession' | 'mobileBearer'
  _pkDevice?: { id: number; deviceId: string }
}

/** GET /api/v1/me — profile, effective roles, employee link, settings subset for the APK. */
export const meEndpoint = v1({
  path: '/me',
  method: 'get',
  handler: async ({ req }) => {
    const u = req.user as unknown as UserShape
    const employeeId = relId(u.employee)
    const employee =
      employeeId === undefined
        ? null
        : await req.payload.findByID({
            collection: 'employees',
            id: employeeId,
            depth: 0,
            select: { code: true, name: true },
            overrideAccess: false,
            req,
            disableErrors: true,
          })
    const s = await req.payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: false, req })
    return json({
      id: u.id,
      email: u.email,
      name: u.name ?? null,
      roles: userRoles(req),
      // ADR 0013 (E1): what the APK should show. Decisions (approval inbox) = Direktur (pk-owner) or
      // Finance only; the PM monitors the team list. The server guard stays authoritative.
      capabilities: {
        approvalInbox: userRoles(req).some((r) => r === 'pk-owner' || r === 'pk-finance'),
        teamMonitor: userRoles(req).includes('pk-pm'),
        // E4 (requirements §4): progress reports are created by the PM (team projects) or the Direktur.
        progressReportCreate: userRoles(req).some((r) => r === 'pk-pm' || r === 'pk-owner'),
      },
      employee: employee ? { id: employee.id, code: employee.code, name: employee.name } : null,
      authMethod: u._strategy ?? 'oidcSession',
      device: u._pkDevice ?? null,
      settings: {
        companyName: s.name,
        shortCode: s.shortCode,
        timezone: s.timezone,
        minAppVersion: s.minAppVersion ?? null,
        offlineMaxAgeDays: s.offlineMaxAgeDays,
        defaultGeofenceRadiusM: s.defaultGeofenceRadiusM,
        receiptRoundingTolerance: s.receiptRoundingTolerance,
        receiptMaxAgeDays: s.receiptMaxAgeDays,
        imageTargets: {
          receiptsMaxPx: s.imageTargets?.receiptsMaxPx ?? 1600,
          selfiesMaxPx: s.imageTargets?.selfiesMaxPx ?? 720,
          transferProofsMaxPx: s.imageTargets?.transferProofsMaxPx ?? 1600,
          progressPhotosMaxPx: s.imageTargets?.progressPhotosMaxPx ?? 1600,
          jpegQuality: s.imageTargets?.jpegQuality ?? 80,
        },
      },
      serverTime: new Date().toISOString(),
    })
  },
})
