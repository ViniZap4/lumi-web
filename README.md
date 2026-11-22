# lumi-web

> **🚧 Work in progress** — lumi is under active development. Features may change, break, or be incomplete.

Web client for [lumi](https://github.com/ViniZap4/lumi) — a local-first, markdown-based note-taking system.

Built with [Svelte 5](https://svelte.dev) and [Vite](https://vite.dev).

## Features

- Password login screen with session persistence (localStorage)
- Modern dark theme
- Folder and note browsing
- Live markdown preview with syntax highlighting
- Yazi-style miller-column browser (parent | folder | preview), same grammar as the TUI
- Real-time sync via WebSocket, authenticated with single-use tickets (falls back to `?token=` on older servers)

## Keyboard (book view)

Folders are derived from note paths. Keys apply outside text fields.

| Key | Browsing columns | Reading a note (after `Enter`) |
|-----|------------------|--------------------------------|
| `j` / `k`, `↓` / `↑` | move cursor (preview follows) | scroll |
| `h` / `←` | parent folder (no-op at the book root) | back to the columns |
| `l` / `→` / `Enter` | enter folder / open note | — |
| `H` / `L` | folder history back / forward | `H`: back to columns + history back |
| `gg` / `G`, `Home` / `End` | first / last row | top / bottom of the note |
| `PgUp` / `PgDn`, `Ctrl-u` / `Ctrl-d` | page / half page | half page (`Ctrl-u`/`Ctrl-d`) |
| `gh`, `zh` | book root ("home") | book root |
| `zp` | toggle the preview column | — |
| `/` | filter the current folder (`Enter` keeps it, `Esc` clears) | — |
| `Esc` | clear filter, else open the book picker | back to the columns |
| `n` / `e` / `dd` / `r` | new note in this folder / edit / delete / refresh | same |
| `g1`–`g9`, `gb`, `⌃⌘1–9` (macOS) | open book N / book picker | same |

Chord rules: `g` and `z` start a 500 ms chord. `gg` keeps meaning "top"
(of the current column), `g1`–`g9`/`gb` keep opening books, `gh` is the
TUI's "home" and `zh` an alias. An unknown second key cancels the chord
and runs normally (`g` then `j` still moves down). Changed from the
flat list: `h` no longer leaves the book at the root (use `Esc` or
`gb`), and `l` enters folders instead of only opening notes.

Mouse: click a folder to enter it, click a note to preview it,
double-click to open; the parent column, the preview column and the
breadcrumb are clickable. Under 720 px only one column is shown, with
the breadcrumb for going up.

## Dev

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # Production build
```

### Environment Variables

`VITE_LUMI_SERVER_URL` is a **build-time** variable baked into the bundle by Vite.

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_LUMI_SERVER_URL` | `http://localhost:8080` | URL the browser uses to reach the API server. Baked into the JS bundle — changing it requires a rebuild. |

### Docker

```bash
docker build --build-arg VITE_LUMI_SERVER_URL=http://your-server:8080 \
  -t lumi-web .
docker run -d -p 3000:80 lumi-web
```

The server URL is baked at image build time via `ARG`. Changing it requires a rebuild.

## Documentation

Full docs at [lumi-note.vercel.app/#/docs](https://lumi-note.vercel.app/#/docs).

## Part of lumi

This is a component of the [lumi monorepo](https://github.com/ViniZap4/lumi).