/* THIS FILE WAS GENERATED AUTOMATICALLY BY PAYLOAD. */
/* DO NOT MODIFY IT BECAUSE IT COULD BE REWRITTEN AT ANY TIME. */
import config from '@payload-config'
import '@payloadcms/next/css'
import type { ServerFunctionClient } from 'payload'
import { handleServerFunctions, RootLayout } from '@payloadcms/next/layouts'
import React from 'react'

import { fontBody, fontHeading } from '@/theme/fonts'
import { themeCssVariables } from '@/theme/tokens'

import { importMap } from './admin/importMap.js'
import './custom.scss'

type Args = {
  children: React.ReactNode
}

const serverFunction: ServerFunctionClient = async function (args) {
  'use server'
  return handleServerFunctions({
    ...args,
    config,
    importMap,
  })
}

// Web-starter design system (src/theme): self-hosted next/font variables + colour tokens on <html>
// through RootLayout's public `htmlProps` prop (@payloadcms/next 3.90.1 layouts/Root/index.d.ts).
// Only this block differs from the generated Payload template.
const htmlProps = {
  className: `${fontHeading.variable} ${fontBody.variable}`,
  style: themeCssVariables() as React.CSSProperties,
}

const Layout = ({ children }: Args) => (
  <RootLayout config={config} htmlProps={htmlProps} importMap={importMap} serverFunction={serverFunction}>
    {children}
  </RootLayout>
)

export default Layout
