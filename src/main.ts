import { mount } from 'svelte'
import './app.css'
import { parsePublicPath, publicServer } from './public/public-api.ts'

const target = document.getElementById('app')!

// /p/:slug — the anonymous public reader (M3). Mounted INSTEAD of the
// app: no session boots, no account is loaded, so the logged-in token
// can never reach a public endpoint.
const pub = typeof location !== 'undefined' ? parsePublicPath(location.pathname) : null

const app = pub
  ? import('./public/PublicReader.svelte').then((m) =>
      mount(m.default, {
        target,
        props: {
          ...pub,
          server: publicServer((import.meta.env.VITE_LUMI_SERVER_URL as string | undefined) || null, location.origin),
        },
      }),
    )
  : import('./App.svelte').then((m) => mount(m.default, { target }))

export default app
