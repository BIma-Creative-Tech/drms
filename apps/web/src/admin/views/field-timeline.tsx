import type { PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { ACTIVITY_KIND_LABELS, addDays, PO_STATUS_LABELS, SERVICE_TYPE_LABELS, UNIT_STATUS_LABELS, type ActivityKind, type PoStatus, type ServiceType, type UnitStatus } from '@/domain/field/rules'
import { listActivities } from '@/domain/field/aftersales'
import { listServiceReports } from '@/domain/field/service'
import { itemsText, longDate, mergeTimeline, TIMELINE_LABELS, TIMELINE_TYPES, timelineTypesFor, timelineWindow, type TimelineEntry, type TimelineType } from '@/domain/field/views'
import { contractsOf, timesheetsOf, todayOf, type ProjectOpt } from '@/domain/field/web'

import { Chips, OpenAction, type SP, one } from './field-ui'
import { Card, EmptyState } from './viz'

/**
 * FR1 project timeline (plan "Project memakai timeline", mockup Web-Timeline): every field report of
 * ONE project merged per date — service reports, the day summary of the unit timesheets ("2 dari 3
 * unit diisi" against the contract units active that day, HM gaps), aftersales activities — with type
 * filter chips (?jenis=) and a 30-day window (?dari/&sampai). Daily construction reports (P3) plug in
 * through `extraEntries` (TimelineEntry of type 'harian'). Data in the caller's read scope.
 */
export type ExtraTimelineSource = (req: PayloadRequest, project: ProjectOpt, window: { from: string; to: string }) => Promise<TimelineEntry[]>

/** P3 hook: daily construction reports register a source here (none in P1). */
export const EXTRA_TIMELINE_SOURCES: ExtraTimelineSource[] = []

export async function ProjectTimeline({ req, project, sp, base, i = 0 }: { req: PayloadRequest; project: ProjectOpt; sp: SP; base: string; i?: number }) {
  const offered = timelineTypesFor(project.kind)
  const today = await todayOf(req, project.companyId)
  const w = timelineWindow(one(sp.dari), one(sp.sampai), today)
  const jenis = one(sp.jenis)
  const filter = (TIMELINE_TYPES as readonly string[]).includes(jenis ?? '') && offered.includes(jenis as TimelineType) ? (jenis as TimelineType) : 'semua'
  const types = filter === 'semua' ? offered : [filter]
  const [services, timesheets, contracts, activities, extra] = await Promise.all([
    types.includes('servis') ? listServiceReports(req, { projectId: project.id, from: w.from, to: w.to, limit: 300 }) : Promise.resolve({ items: [] }),
    types.includes('timesheet') ? timesheetsOf(req, { projectIds: [project.id], from: w.from, to: w.to }) : Promise.resolve([]),
    types.includes('timesheet') ? contractsOf(req, [project.id]) : Promise.resolve([]),
    types.includes('aktivitas') ? listActivities(req, { projectId: project.id, from: w.from, to: w.to, limit: 500 }) : Promise.resolve({ items: [] }),
    Promise.all(EXTRA_TIMELINE_SOURCES.map((src) => src(req, project, w))).then((xs) => xs.flat()),
  ])
  const groups = mergeTimeline({
    from: w.from,
    to: w.to,
    today,
    types,
    contracts,
    services: services.items.map((s) => ({
      id: s.id,
      docNo: s.docNo,
      reportDate: s.reportDate,
      unitLabel: s.unit.label ?? `Unit #${s.unit.id}`,
      serviceTypeLabel: SERVICE_TYPE_LABELS[s.serviceType as ServiceType] ?? String(s.serviceType),
      statusLabel: UNIT_STATUS_LABELS[s.unitStatusAfter as UnitStatus] ?? String(s.unitStatusAfter),
      statusOk: s.unitStatusAfter === 'siap',
      action: s.action,
      hourMeter: s.hourMeter,
      spareparts: s.spareparts.length,
      photos: s.photos.length,
      reporter: s.reporter.name,
      corrected: s.flags.includes('CORRECTED'),
    })),
    timesheets: timesheets.map((t) => ({ id: t.id, reportDate: t.reportDate, unitId: t.unitId, contractUnitId: t.contractUnitId, unitLabel: t.unitLabel, workHours: t.workHours, breakdownHours: t.breakdownHours, hmStart: t.hmStart, hmEnd: t.hmEnd, flags: t.flags })),
    activities: activities.items.map((a) => ({
      id: a.id,
      activityDate: a.activityDate,
      kindLabel: ACTIVITY_KIND_LABELS[a.kind as ActivityKind] ?? String(a.kind),
      clientName: a.client.name,
      docNo: a.docNo,
      items: itemsText(a.items as Array<{ name: string; qty: number; uom?: string | null }>),
      poStatusLabel: a.kind === 'po_masuk' && a.poStatus ? PO_STATUS_LABELS[a.poStatus as PoStatus] : a.relatesTo?.docNo ? `untuk ${a.relatesTo.docNo}` : null,
      reporter: a.reporter.name,
    })),
    extra,
    hrefs: {
      service: (id) => `/admin/laporan-servis/detail/${id}`,
      activity: (id) => `/admin/aftersales/aktivitas/detail/${id}`,
      timesheetDay: (date) => `/admin/unit-kontrak/kontrak/${project.id}?tab=timesheet&bulan=${date.slice(0, 7)}#hari-${date}`,
    },
  })
  const link = (over: Record<string, string | null>) => {
    const u = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') u.set(k, v)
    for (const [k, v] of Object.entries(over)) {
      if (v === null) u.delete(k)
      else u.set(k, v)
    }
    const q = u.toString()
    return q ? `${base}?${q}` : base
  }
  const href = (k: string) => link({ jenis: k === 'semua' ? null : k })
  if (offered.length === 0) {
    return (
      <Card id="timeline" title="Timeline laporan lapangan" i={i}>
        <EmptyState text="Project berjenis ini tidak memakai laporan lapangan (servis, timesheet, aktivitas)." />
      </Card>
    )
  }
  return (
    <Card id="timeline" title="Timeline laporan lapangan" sub={`${longDate(w.from)} – ${longDate(w.to)} · terbaru di atas`} i={i}>
      <Chips label="Jenis laporan" current={filter} chips={[{ key: 'semua', label: 'Semua', href: href('semua') }, ...offered.map((t) => ({ key: t, label: TIMELINE_LABELS[t], href: href(t) }))]} />
      {groups.length === 0 ? (
        <EmptyState text="Belum ada laporan lapangan di rentang ini." />
      ) : (
        <div className="pk-ftl" data-pk-timeline={project.id}>
          {groups.map((g) => (
            <section key={g.date} aria-labelledby={`tl-${g.date}`}>
              <h3 id={`tl-${g.date}`}>{longDate(g.date)}</h3>
              <ul>
                {g.entries.map((e) => (
                  <li key={e.key} data-pk-timeline-entry={e.type}>
                    <span className={`pk-tag ${e.type}`}>{TIMELINE_LABELS[e.type]}</span>
                    <div className="b">
                      <strong>{e.title}</strong>
                      <span>
                        {e.detail}
                        {e.alert ? (
                          <>
                            {e.detail ? ' · ' : ''}
                            <em>{e.alert}</em>
                          </>
                        ) : null}
                      </span>
                    </div>
                    <OpenAction href={e.href} name={`${TIMELINE_LABELS[e.type]} ${longDate(e.date)}`} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="pk-note" style={{ marginTop: 14 }}>
        Rentang maks. 92 hari.{' '}
        <Link className="pk-kbtn sm" href={link({ dari: addDays(w.from, -30), sampai: w.to })} prefetch={false} data-pk-link="timeline-older">
          Tampilkan 30 hari sebelumnya
        </Link>
      </p>
    </Card>
  )
}
