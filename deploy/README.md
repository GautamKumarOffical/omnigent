# Deploying Omnigent

Omnigent ships several ways to deploy the server, organized by
target platform. Pick the one that matches your environment.

## Deploy in one click

No local tooling needed. Pick a platform, click the button, and your
Omnigent server is live with HTTPS in a few minutes.

| Platform | Button | Docs |
|---|---|---|
| **Render** | [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/omnigent-ai/omnigent) | [`render/README.md`](render/README.md) |
| **Railway** | *(button pending — see below)* | [`railway/README.md`](railway/README.md) |

<!-- TODO(oss-release): publish the Railway template at railway.com/new/template
     once the repo is public, then replace the Railway row above with:
     [![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/<template-id>)
     Steps: railway.com/new/template → point at public repo → add Postgres plugin
     → publish → copy the deploy URL → update this file and deploy/railway/README.md. -->

Both provision a managed Postgres database automatically and default to the
built-in `accounts` auth provider — multi-user out of the box, no external IdP.
First boot auto-creates an admin (password in the service logs); invite
teammates from the web UI. Prefer your own IdP? Switch to OIDC after deploy by
setting the `OMNIGENT_OIDC_*` vars (auth stays enabled — the issuer is what
flips the mode); see the platform README for both walkthroughs.

**Three more platforms** are supported with a little more setup (not a single
button): **Fly.io** (`fly deploy`, or its web-UI Launch), **Hugging Face
Spaces** (a demo-grade Docker Space), and **Modal** (`modal deploy`, an
always-on web server with a durable artifact Volume). See the menu below.
Fly and HF Spaces can run on the **SQLite lite tier** with no database to
provision — see [Database: Postgres or SQLite](#database-postgres-or-sqlite);
Modal needs a bring-your-own Postgres.

---

```
deploy/
├── README.md          ← (this file) the menu
│
├── render/            ← Render 1-click deploy
│   └── README.md
│
├── railway/           ← Railway 1-click deploy
│   └── README.md
│
├── fly/               ← Fly.io (CLI `fly deploy`, or web-UI Launch)
│   ├── fly.toml
│   └── README.md
│
├── hf-spaces/         ← Hugging Face Spaces (demo-grade Docker Space)
│   ├── Dockerfile
│   └── README.md
│
├── modal/             ← Modal (`modal deploy`, always-on, durable Volume)
│   ├── modal_app.py
│   └── README.md
│
├── trycloudflare/     ← Cloudflare quick tunnel (public URL for a LOCAL server)
│   └── README.md
│
├── daytona/           ← Daytona sandbox-provider guide + the Cloudflare
│   ├── wrangler.toml     Worker egress relay for its free tier — NOT a
│   ├── src/index.js      server deploy target. See its README.md.
│   └── README.md
│
└── docker/            ← common Docker image + compose stack
    ├── Dockerfile         multi-stage slim image (node web build → python builder → runtime)
    ├── docker-compose.yaml   omnigent + postgres for any Docker host
    ├── entrypoint.py
    ├── .env.example
    ├── README.md
    └── SKILL.md
```

## Pick your target

| If you want to … | Use | Where to look |
|---|---|---|
| **Deploy from a browser (no local tools)** | **Render or Railway** | Buttons above — [Render](render/README.md) · [Railway](railway/README.md) |
| Try the server on your laptop | Docker compose | [`docker/README.md`](docker/README.md) — `docker compose up -d` |
| Run on any host you already have (VPS, home server, on-prem) | Docker compose | [`docker/README.md`](docker/README.md) — copy the compose file, run it |
| Deploy to Fly.io | Fly | [`fly/README.md`](fly/README.md) — `fly deploy`, SQLite on a volume |
| Deploy to Modal (durable artifact Volume) | Modal | [`modal/README.md`](modal/README.md) — `modal deploy`, BYO Neon Postgres |
| Stand up a quick demo (no DB to provision) | HF Spaces | [`hf-spaces/README.md`](hf-spaces/README.md) — Docker Space, SQLite |
| Share a server running on your **laptop** — demo it to teammates, or let remote runners & cloud sandboxes connect back to it (nothing to deploy) | Cloudflare quick tunnel | [`trycloudflare/README.md`](trycloudflare/README.md) — `cloudflared tunnel --url http://localhost:6767` |
| Cloud Run / Kubernetes / other | Docker image | [`docker/README.md`](docker/README.md), then point your platform at the image |

All deploy paths share the same image (`docker/Dockerfile`): a slim Python
container running the FastAPI / WebSocket coordinator, with Postgres or
SQLite as the datastore.

## Database: Postgres or SQLite

The server supports two database backends, both first-class (same schema, same
migrations — pick per `DATABASE_URL`):

- **Postgres** — the default and the production answer. Required for more than
  one server instance. **Managed and auto-provisioned on deploy** on Render and
  Railway. On platforms without a managed database (HF Spaces, Modal, or Fly
  if you want Postgres over volume-SQLite), bring your own — the fastest is
  **Neon**:
  create one at [pg.new](https://pg.new) and set the connection string as
  `DATABASE_URL`. Any `postgres://` / `postgresql://` URL works (pooled or
  direct); the entrypoint normalizes it to the psycopg3 dialect automatically.
- **SQLite** — a zero-dependency "lite tier" for demos and single-instance
  deploys, with no database to provision. The `.db` file lives on the
  platform's persistent disk/volume (Render disk, Fly volume, Railway volume)
  and survives restarts there; on Hugging Face free Spaces the disk is
  ephemeral, so SQLite data resets on restart, and on Modal the Volume's
  eventual-consistency semantics don't suit a live `.db` file, so skip the
  SQLite tier there. Set
  `DATABASE_URL=sqlite:////data/artifacts/chat.db`. Tradeoff: single instance
  only, no managed backups.

**Who provisions the database.** Render and Railway create the Postgres *as part
of the deploy* (one step — it's owned by your platform account). Platforms
without a managed DB don't: there you either run on SQLite (zero setup,
ephemeral on HF) or bring an owned Postgres like Neon (a one-time signup, then
persistent). A deploy can't auto-provision a *persistent* database for you —
persistence requires an owned account, and that's the one step that can't be
automated away.

**First boot against a remote Postgres is slow.** Migrations run over the
network on the first boot (~1 minute on Neon, vs near-instant for local SQLite);
subsequent boots are fast. Make sure the platform's healthcheck grace tolerates
it — Render and Railway do by default; on Fly, raise `grace_period` if you use a
remote DB.

**Memory floor:** the server's working set is ~512 MB–1 GB. Render Starter
(512 MB), Railway (usage-scaled), and HF Spaces clear it automatically; Fly's
256 MB default does not, so the Fly config pins a 1 GB machine, and the
Modal app pins `memory=1024` for the same reason.

## Execution model

Omnigent runs in two pieces that talk to each other over a
WebSocket tunnel:

- **Server** — the FastAPI app you deploy here. Handles HTTP / SSE
  routes, terminal-attach WebSockets, persistence, web UI.
- **Runner** — a Python subprocess that runs on the **user's
  machine** (laptop, dev container, etc.). Dials in to the server
  via `WS /v1/runner/tunnel`, executes the LLM loop + tools locally,
  streams events back.

The deploy options here are all about the server. Runners aren't
deployed — every user launches one on their own machine with
`omnigent run …  --server <url>` or `omnigent claude  --server <url>`.

This separation is why the server image is small (no `tmux`, no
harness SDKs, no LLM API keys in the image) and why no agent code
runs inside it.

## Auth

Auth is driven by a single switch, `OMNIGENT_AUTH_ENABLED`. The framework
default (a bare local `omnigent server`) leaves it off — single-user
`header` mode, no login. The containerized deploys here (Docker / HF / Render /
Railway / Modal / Fly) set `OMNIGENT_AUTH_ENABLED=1` by default in their
entrypoints,
since a network-exposed instance should be authenticated. With the switch on,
the mode is chosen by your config: supply the `OMNIGENT_OIDC_*` vars and you
get `oidc`, otherwise you get the built-in `accounts` flow.
`OMNIGENT_AUTH_PROVIDER` is an explicit escape hatch that pins the mode and
overrides this auto-selection.

| Mode | When to use | What's needed |
|---|---|---|
| `accounts` (deploy default) | Standalone deploy, no external IdP — built-in username/password with first-user-is-admin bootstrap and UI-based invites. Opt in with `OMNIGENT_AUTH_ENABLED=1` (and no OIDC vars). | Set `OMNIGENT_ACCOUNTS_COOKIE_SECRET` (or let `bootstrap.sh` mint it) and `OMNIGENT_ACCOUNTS_BASE_URL` (public URL). On first boot, set the admin password via the web Create-admin form, the terminal prompt, or `--admin-password` / `OMNIGENT_ACCOUNTS_INIT_ADMIN_PASSWORD`. |
| `oidc` | Standalone deploy with your own IdP — server handles the full login flow | Set `OMNIGENT_AUTH_ENABLED=1` and the `OMNIGENT_OIDC_*` env vars; the presence of `OMNIGENT_OIDC_ISSUER` selects OIDC (or pin `OMNIGENT_AUTH_PROVIDER=oidc`). Requires HTTPS (the session cookie uses the `__Host-` prefix). |
| `header` | Behind an existing SSO proxy (oauth2-proxy, AWS ALB OIDC, Tailscale Funnel, …) that injects `X-Forwarded-Email` | The default when `OMNIGENT_AUTH_ENABLED` is off; or pin `OMNIGENT_AUTH_PROVIDER=header`. Proxy MUST strip any inbound copy of the header from clients. Missing headers are always rejected. |

For the manual setup, see
[`docker/README.md#multi-user-mode-oidc`](docker/README.md#multi-user-mode-oidc)
for the GitHub OAuth, Google Workspace, and generic OIDC
walkthroughs.

## Adding a new deploy target

Drop a new subdirectory under `deploy/<target>/` with a `README.md`
and `SKILL.md`. If the new target uses the existing Docker image,
your work is mostly platform-specific glue (a `fly.toml`, a Cloud
Run service.yaml, a Helm chart, an HF Spaces config) plus a README
that explains how to point that platform at `docker/Dockerfile`.

Update this top-level README with a row in the table above.
