# lumi-web

> **🚧 Work in progress** — lumi is under active development. Features may change, break, or be incomplete.

Web client for [lumi](https://github.com/ViniZap4/lumi) — a local-first, markdown-based note-taking system.

Built with [Svelte 5](https://svelte.dev) and [Vite](https://vite.dev).

## Features

- Password login screen with session persistence (localStorage)
- Modern dark theme
- Folder and note browsing
- Live markdown preview with syntax highlighting
- Vim keybindings (j/k navigation, / search)
- Real-time sync via authenticated WebSocket

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
| `VITE_LUMI_SERVER_URL` | `http://localhost:8080` | Server URL as seen by the browser |

### Docker

```bash
docker build --build-arg VITE_LUMI_SERVER_URL=http://your-server:8080 \
  -t lumi-web .
docker run -d -p 3000:80 lumi-web
```

The server URL is baked at image build time via `ARG`. Changing it requires a rebuild.

## Part of lumi

This is a component of the [lumi monorepo](https://github.com/ViniZap4/lumi).