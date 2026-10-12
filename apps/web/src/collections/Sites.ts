import type { CollectionConfig, Where } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, rolesAllowed } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { siteFromCostCenterDefault } from '@/domain/sites'
import { activeField, codeField, uuidField } from '@/fields/common'
import { companyField, companyHook, pickerSameCompany, sameCompanyOptions } from '@/fields/company'

/**
 * ADR 0023 (owner 2026-10-11): Site = kantor cabang of the PT (same legal entity, same numbering, approvals
 * and access per PT). One site handles several projects; a project belongs to at most one site. Per-PT master:
 * Admin C/R/U, Direktur R/U, every member of the PT R (it carries no money; APK attendance location list).
 * Optional geofence (same fields as projects / cost centers; empty radius → PT default), default work schedule
 * (schedule resolution employee → home site → PT) and default cost center (operational, transfer default of the
 * site's projects without their own). No delete: deactivate (history keeps it).
 * "Buat site dari pusat biaya" (Q-S2): /admin/collections/sites/create?costCenter=<id> pre-fills PT, kode, nama,
 * titik and pusat biaya from that cost center (domain/sites.ts siteFromCostCenterDefault).
 */
export const Sites: CollectionConfig = withAudit(
  {
    slug: 'sites',
    labels: { singular: 'Site (kantor cabang)', plural: 'Site' },
    admin: {
      useAsTitle: 'name',
      group: 'Master Data',
      defaultColumns: ['code', 'name', 'address', 'costCenter', 'active'],
      description: 'Kantor cabang PT (mis. Cabang Balikpapan). Satu site menangani beberapa project; absensi kantor cabang memakai titik + radius site.',
    },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true, 'pk-pm': true, 'pk-staff': true, 'pk-operator': true }),
      create: rolesAllowed('pk-admin', 'pk-owner'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: {
      beforeChange: [
        companyHook('sites', {
          check: [
            { field: 'defaultWorkSchedule', collection: 'work-schedules' },
            { field: 'costCenter', collection: 'cost-centers' },
          ],
        }),
      ],
    },
    fields: [
      { ...companyField(), defaultValue: siteFromCostCenterDefault('company') },
      { ...codeField('Kode', 32, { perCompany: true }), defaultValue: siteFromCostCenterDefault('code') },
      { name: 'name', type: 'text', label: 'Nama site', required: true, maxLength: 128, defaultValue: siteFromCostCenterDefault('name') },
      { name: 'address', type: 'textarea', label: 'Alamat', maxLength: 500 },
      {
        type: 'row',
        fields: [
          { name: 'lat', type: 'number', label: 'Latitude', min: -90, max: 90, defaultValue: siteFromCostCenterDefault('lat') },
          { name: 'lng', type: 'number', label: 'Longitude', min: -180, max: 180, defaultValue: siteFromCostCenterDefault('lng') },
          {
            name: 'radiusM',
            type: 'number',
            label: 'Radius geofence (m)',
            min: 10,
            max: 5000,
            defaultValue: siteFromCostCenterDefault('radiusM'),
            admin: { description: 'Kosong = radius default perusahaan (Setting perusahaan). Tanpa titik = absensi di site ini belum bisa.' },
          },
        ],
      },
      {
        name: 'defaultWorkSchedule',
        type: 'relationship',
        relationTo: 'work-schedules',
        label: 'Jadwal kerja default',
        ...pickerSameCompany(),
        admin: { placeholder: 'Pilih jadwal kerja…', description: 'Untuk karyawan dengan site penempatan ini yang tidak punya jadwal sendiri. Kosong = jadwal default perusahaan.' },
      },
      {
        name: 'costCenter',
        type: 'relationship',
        relationTo: 'cost-centers',
        label: 'Pusat biaya default',
        index: true,
        defaultValue: siteFromCostCenterDefault('costCenter'),
        ...pickerSameCompany(),
        filterOptions: (args: { data?: unknown }): Where => {
          const same = sameCompanyOptions(args)
          return same === true ? { type: { equals: 'operational' } } : { and: [same, { type: { equals: 'operational' } }] }
        },
        admin: { placeholder: 'Pilih pusat biaya…', description: 'Pusat biaya operasional kantor cabang; diusulkan ke Finance untuk project site ini yang belum punya pusat biaya.' },
      },
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'site', reasonRules: [reasonOnDeactivate] },
)
