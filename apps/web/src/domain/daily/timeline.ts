import type { PayloadRequest } from 'payload'

import type { TimelineEntry } from '@/domain/field/views'
import { formatNumber } from '@/lib/money'

import { DAILY_FLAGS, WEATHER_LABELS, type Weather } from './rules'
import { listDailyReports } from './service'

const fmt = (v: number) => formatNumber(v, 2)

/** P3: daily construction reports of one project as timeline entries (type 'harian'), caller's read scope. */
export async function dailyTimelineEntries(req: PayloadRequest, project: { id: number; kind?: string | null }, w: { from: string; to: string }): Promise<TimelineEntry[]> {
  if (project.kind !== 'konstruksi') return []
  const { items } = await listDailyReports(req, { projectId: project.id, from: w.from, to: w.to, limit: 500 })
  return items.map((d) => {
    const weather = [d.weather.morning, d.weather.noon, d.weather.afternoon].filter((x): x is Weather => !!x)
    const work = d.work.slice(0, 3).map((x) => `${x.item.code} ${fmt(x.qty)} ${x.item.uom}`)
    const facts = [
      work.length ? work.join(', ') + (d.work.length > 3 ? ` +${d.work.length - 3}` : '') : null,
      d.workerCount ? `${d.workerCount} pekerja` : null,
      weather.includes('hujan') ? `hujan${d.rainHours ? ` ${fmt(d.rainHours)} jam` : ''}` : weather.length ? WEATHER_LABELS[weather[0]!] : null,
      d.photos.length ? `${d.photos.length} foto` : null,
      d.reporter.name,
      d.flags.includes(DAILY_FLAGS.corrected) ? 'dikoreksi' : null,
    ].filter(Boolean)
    const over = d.flags.includes(DAILY_FLAGS.overRap)
    const dup = d.flags.includes(DAILY_FLAGS.possibleDuplicate)
    return {
      key: `lh-${d.id}`,
      type: 'harian' as const,
      date: d.reportDate,
      title: `${d.docNo ?? `Laporan harian #${d.id}`}${d.issues ? ' · ada kendala' : ''}`,
      detail: facts.join(' · '),
      alert: over ? 'melebihi RAP' : dup ? 'kemungkinan dobel' : undefined,
      href: `/admin/laporan-harian/detail/${d.id}`,
      tone: over ? ('bad' as const) : dup ? ('warn' as const) : undefined,
    }
  })
}
