/* THIS FILE WAS GENERATED AUTOMATICALLY BY PAYLOAD. */
/* DO NOT MODIFY IT BECAUSE IT COULD BE REWRITTEN AT ANY TIME. */
import type { Metadata } from 'next'

import config from '@payload-config'
import { RootPage, generatePageMetadata } from '@payloadcms/next/views'
import { importMap } from '../importMap'

import { redirectDeniedCreate } from '@/admin/denied-create'

type Args = {
  params: Promise<{
    segments: string[]
  }>
  searchParams: Promise<{
    [key: string]: string | string[]
  }>
}

export const generateMetadata = ({ params, searchParams }: Args): Promise<Metadata> =>
  generatePageMetadata({ config, params, searchParams })

// ProyekKas QA-24 (keep on regeneration): a logged-in caller without create access is redirected to
// our uniform no-access page instead of Payload's hard-coded "Tidak sah, Anda harus masuk…" view.
const Page = async ({ params, searchParams }: Args) => {
  await redirectDeniedCreate({ config, importMap, params })
  return RootPage({ config, params, searchParams, importMap })
}

export default Page
