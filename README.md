# Statty

A small self-hosted status app, in the spirit of Uptime Kuma. It keeps a flat list of
monitors, each either a **URL health check** or a **Docker container's state**, and shows
them on a public status page. It has a REST API with API keys and an MCP server that
AI clients sign in to with OAuth. Data lives in one SQLite file.

The stack and UI come from Chatty (`../ai-chat`): SvelteKit 2, Svelte 5, Tailwind 4,
shadcn-svelte, better-sqlite3 and better-auth.

## Features

- **Monitors**
  - **HTTP:** method, accepted status codes (`200-299,301`), an optional body keyword,
    and an option to ignore TLS errors.
  - **Docker:** a container is up while it is running, and healthy if it has a health
    check. A container that is starting counts as pending.
  - **Checks:** each monitor has its own interval, timeout and retries. With retries, a
    failing monitor stays pending until it has failed `retries + 1` times in a row.
  - **Dashboard:** status, 24h/7d/30d uptime, a response-time chart and a list of status
    changes.
  - **Site icons:** HTTP monitors show their site's favicon on the dashboard, the detail page
    and the status page. It is fetched in the background: the home page's `icon` /
    `apple-touch-icon` links (SVG or a square PNG of 32px or more preferred), else
    `/favicon.ico`. It must be a real image under 256 KB. Icons are cached per origin and
    refreshed weekly, and a failed search is retried after a day. Docker monitors show a
    container icon.
- **Live UI:** check results stream in over server-sent events (`/api/events` for signed-in
  users, `/api/public/events` for the status page) instead of polling.
  - Rolling digits for counts, uptime and response times, and live "checked 12s ago" timers.
  - Heartbeat bars grow in, and rows flash when their status changes.
  - If the stream can't connect (e.g. behind a buffering proxy), pages fall back to reloading
    every 15–30s.
- **Notifications:** Statty can push a message to [Gotify](https://gotify.net) when a monitor
  goes down and when it is up again. Admins set channels up under Settings → Notifications.
  - **Channel settings:** server URL, app token and priority (0–10, default 8). Each channel
    covers all monitors or a chosen set.
  - **Token storage:** the token is encrypted at rest (AES-256-GCM with a key derived from
    `APP_SECRET`) and is never sent back to the browser.
  - **When it sends:** when a monitor turns down (from up, pending or not checked yet), and
    when it recovers from down. A recovery message says how long the monitor was down.
    Pending checks, a monitor's first up check and paused monitors never send.
  - **Delivery:** messages are markdown and link to the monitor's page through `ORIGIN`. They
    go out in the background with a 10s timeout, so a slow server never delays checks.
    Failures are logged.
  - **Send test** checks a channel from the UI. The code is written so other channel types
    (ntfy, webhooks) can be added later.
- **Public status page** at `/status`. It shows names and status only, never URLs,
  containers or error messages. You choose which monitors appear on it, and an admin
  sets its title and description.
- **Sign-in:** email + password, OIDC, or both, as in Chatty. The first account becomes
  admin, and admins manage users.
- **REST API** at `/api/v1`. Callers authenticate with API keys (`Authorization: Bearer sty_…`).
  - `status:read` reads monitors and status.
  - `monitors:write` also creates, changes, pauses, deletes and checks them.
- **MCP server** at `/api/mcp` (Streamable HTTP, stateless).
  - **OAuth:** MCP clients use OAuth 2.1 with dynamic client registration and PKCE. The user
    signs in to Statty (password or OIDC) and chooses whether the client may change
    monitors. Each approval appears under Settings → API & MCP as a key you can revoke.
  - **Tools:** `list_monitors` and `get_monitor`. With write access the client also gets
    `create_monitor`, `update_monitor`, `delete_monitor` and `check_monitor`.

```sh
claude mcp add --transport http statty https://status.example.com/api/mcp
```

## Running

```sh
pnpm install
cp .env.example .env   # set ORIGIN, APP_SECRET, OIDC_* as needed
pnpm dev               # or: pnpm build && node build
```

With Docker, `docker compose up -d` builds the image. Data goes to the `data` volume, and
the compose file mounts `/var/run/docker.sock` read-only for Docker monitors.

### Configuration

| Variable                                              | Default                                                                   | Notes                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `ORIGIN`                                              | request origin                                                            | Public URL; OAuth and notification links use it (else `localhost:$PORT`)     |
| `APP_SECRET`                                          | generated into `<db dir>/.secret`                                         | Signs sessions and encrypts stored secrets (e.g. Gotify tokens)              |
| `DATABASE_PATH`                                       | `./data/statty.db`                                                        |                                                                              |
| `ENABLE_SIGNUP` / `ENABLE_PASSWORD_LOGIN`             | `true`                                                                    |                                                                              |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | –                                                                         | Callback URL: `<ORIGIN>/api/auth/oauth2/callback/oidc`                       |
| `OIDC_SCOPES`                                         | `openid profile email`                                                    |                                                                              |
| `OIDC_ONLY`                                           | `false`                                                                   | Turns off password login and sign-up                                         |
| `AUTO_PROMOTE_FIRST_USER`                             | `true`                                                                    |                                                                              |
| `DOCKER_HOST`                                         | `unix:///var/run/docker.sock` (Windows: `npipe:////./pipe/docker_engine`) | Also `tcp://host:2375`, `https://host:2376`. A monitor can set its own host. |
| `HEARTBEAT_RETENTION_DAYS`                            | `90`                                                                      | Older checks are pruned hourly                                               |

## API

| Method | Path                                             | Scope            |
| ------ | ------------------------------------------------ | ---------------- |
| GET    | `/api/v1/status`                                 | `status:read`    |
| GET    | `/api/v1/monitors?recent=30`                     | `status:read`    |
| GET    | `/api/v1/monitors/:idOrName`                     | `status:read`    |
| GET    | `/api/v1/monitors/:idOrName/heartbeats?hours=24` | `status:read`    |
| POST   | `/api/v1/monitors`                               | `monitors:write` |
| PATCH  | `/api/v1/monitors/:idOrName`                     | `monitors:write` |
| DELETE | `/api/v1/monitors/:idOrName`                     | `monitors:write` |
| POST   | `/api/v1/monitors/:idOrName/check`               | `monitors:write` |
| GET    | `/api/public/status`                             | none (CORS open) |
| GET    | `/api/monitors/:id/favicon`                      | see below        |

Notification channels are managed by signed-in admins, not with API keys. The routes are
`GET`/`POST /api/notifications`, `GET`/`PATCH`/`DELETE /api/notifications/:id` and
`POST /api/notifications/:id/test`. A channel body is
`{ name, type: "gotify", enabled, allMonitors, monitorIds, config: { url, token, priority } }`.
On `PATCH`, a blank `config.token` keeps the stored one.

Monitor fields: `name` (unique, ignoring case), `type` (`http` | `docker`), `url`, `method`,
`acceptedStatuses`, `keyword`, `ignoreTls`, `container`, `dockerHost`, `intervalSeconds`
(10–86400), `timeoutSeconds` (≤ interval), `retries`, `enabled`, `public`, `description`,
`sortOrder`. Responses also carry `faviconUrl`, which is null for Docker monitors or when no
icon was found. It is on `/api/public/status` too. `faviconUrl` points at
`/api/monitors/:id/favicon?v=<hash>`, which serves the cached icon. Public monitors' icons are
served without sign-in. Other monitors need a session or `status:read`. The schema is in `src/lib/server/monitor/input.ts`. Errors come back as
`{ "message": "field: problem" }`.

## Development

- `pnpm check`: typecheck
- `pnpm lint`: Prettier and ESLint
- `pnpm test`: unit tests
- Migrations are numbered SQL files in `migrations/` and are applied at startup. To change
  the schema, add the next file; don't edit an applied one.
- Server code lives in `src/lib/server/`:
  - `monitor/`: checks, scheduler and the service layer
  - `favicon/`: finding, validating and caching site icons
  - `notifications/`: notification channels. Each type is a driver; Gotify is in `gotify.ts`
  - `mcp/`: the MCP server
  - `oauth-server/`: OAuth for MCP
  - `db/repo/`: storage
