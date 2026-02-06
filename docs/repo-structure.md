# Repo Structure

```
.
├── bin/
│   ├── zane                          # CLI entry point
│   └── self-host.sh                  # Self-host deployment wizard
├── docs/                             # Project documentation
├── migrations/                       # D1 database migrations
├── public/
│   ├── icons/                        # PWA icons
│   ├── manifest.json                 # PWA manifest
│   └── sw.js                         # Service worker
├── services/
│   ├── anchor/                       # Bun local bridge + app-server relay
│   │   ├── src/
│   │   └── package.json
│   ├── auth/                         # Cloudflare Worker for passkey auth
│   │   ├── src/
│   │   └── wrangler.toml
│   └── orbit/                        # Cloudflare Worker + Durable Object
│       ├── src/
│       └── wrangler.toml
├── src/                              # Web client (Svelte)
│   ├── lib/
│   │   ├── components/
│   │   └── styles/
│   ├── routes/
│   └── global.css
├── .env.example
├── install.sh                        # Installation script
├── package.json
├── tsconfig.json
├── vite.config.ts
├── svelte.config.js
└── wrangler.toml                     # Web client Pages config
```

## Notes
- The top-level `src/` is the web client (Svelte + Vite).
- The web client is static and deploys to Cloudflare Pages.
- Auth and Orbit run on Cloudflare Workers with D1 for storage.
- Anchor is Bun-only and runs locally on macOS.
- `bin/zane` is the CLI entry point for local usage.
- `bin/self-host.sh` is the self-host deployment wizard invoked by `zane self-host`.
- `install.sh` handles cloning, dependency install, and PATH setup.
