import { z } from 'zod'

import { writeAudit } from '@/audit/writer'

import { json, problem, v1 } from '../http'

const email = z.email()

/**
 * POST /api/v1/admin/test-email — Admin only. Queues ONE test mail to the CALLER's own address
 * (no recipient in the request: the endpoint cannot be used to mail third parties), audited in
 * the same transaction as the queued job. Sent by the worker (jobs/tasks.ts sendEmail) through
 * the SMTP adapter, so it also exercises the mailbox rate guard. 3 per admin per hour on top of
 * the global mailbox budget. 503 when SMTP is not configured (console adapter).
 */
export const testEmailEndpoint = v1({
  path: '/admin/test-email',
  method: 'post',
  roles: ['pk-admin'],
  rateLimit: [3, 60 * 60_000],
  transactional: true,
  handler: async ({ req }) => {
    if (req.payload.email.name === 'console') {
      return problem(503, 'Service Unavailable', { detail: 'SMTP belum dikonfigurasi.' })
    }
    const u = req.user as unknown as { id: number; email?: string }
    if (!email.safeParse(u.email).success) return problem(409, 'Conflict', { detail: 'Akun ini tidak punya alamat email yang valid.' })
    const job = await req.payload.jobs.queue({
      task: 'sendEmail',
      input: {
        userId: u.id,
        subject: 'RR Teams — email uji',
        text:
          'Ini email uji dari RR Teams.\n\n' +
          'Dikirim atas permintaan admin sendiri melalui POST /api/v1/admin/test-email.\n' +
          'Jika Anda tidak meminta email ini, abaikan dan laporkan ke admin sistem.\n',
      },
      req,
    })
    await writeAudit(req, [{ action: 'email_test', docType: 'users', docId: String(u.id), newValue: { jobId: String(job.id) } }])
    return json({ queued: true, jobId: String(job.id) }, 202)
  },
})
