# Peak Paperclip — Deployment Guide

This fork uses a **container-first** deployment model. Docker images are built
automatically by GitHub Actions (`.github/workflows/docker.yml`) on every push
to `master` and every `v*` tag, then pushed to the GitHub Container Registry
(GHCR) at `ghcr.io/michaldanilczyk-ops/peak-paperclip`.

**You never build Docker images on your laptop or server.** Just `docker pull`
and run.

---

## Architecture

```
┌──────────────┐       push        ┌──────────────────┐
│  Local dev   │ ─────────────────▶│  GitHub Actions  │
│  (MacBook)   │                   │  docker.yml      │
└──────────────┘                   └────────┬─────────┘
                                            │ docker push
                                            ▼
                                  ┌──────────────────┐
                                  │ GHCR (registry)  │
                                  │ :latest, :sha-…  │
                                  └────────┬─────────┘
                                           │ docker pull
                        ┌──────────────────┴──────────────────┐
                        ▼                                     ▼
             ┌─────────────────────┐              ┌─────────────────────┐
             │  Mac Mini (today)   │              │  Cloud VPS (later)  │
             │  docker compose up  │              │  docker compose up  │
             └─────────────────────┘              └─────────────────────┘
```

All persistent state (embedded Postgres, agent files, logs, secrets) lives in
one Docker volume: `peak-paperclip-data`. Back that up to preserve data across
image upgrades.

---

## Local Development (no Docker needed)

For iterating on code, use native mode — faster than any Docker loop:

```sh
cd ~/Documents/Claude/Projects/peak-paperclip
pnpm install
export BETTER_AUTH_SECRET=$(openssl rand -hex 32)
pnpm dev
# → http://localhost:3100
```

Embedded Postgres starts automatically. No external DB required.

When you're ready to test the production container:

```sh
git push origin master                  # kicks off GitHub Actions
# wait ~5 minutes, then:
docker compose -f docker-compose.peak.yml up -d
```

---

## Deploy on Mac Mini

### One-time setup

```sh
ssh peak-mini
cd ~/Documents
git clone git@github.com:michaldanilczyk-ops/peak-paperclip.git
cd peak-paperclip

# Generate + save the auth secret (keep this — don't regenerate or all sessions die)
openssl rand -hex 32 > ~/.peak-paperclip.auth-secret

# Log in to GHCR so the pull works (images are private by default on a private fork)
echo $GITHUB_PAT | docker login ghcr.io -u michaldanilczyk-ops --password-stdin
```

### Run / update

```sh
export BETTER_AUTH_SECRET=$(cat ~/.peak-paperclip.auth-secret)
export PAPERCLIP_PUBLIC_URL="http://peakpeaks-mac-mini.tail43e23a.ts.net:3100"
docker compose -f docker-compose.peak.yml pull
docker compose -f docker-compose.peak.yml up -d
docker compose -f docker-compose.peak.yml logs -f paperclip     # watch startup
```

### Upgrade to newest master

```sh
cd ~/Documents/peak-paperclip
git pull
docker compose -f docker-compose.peak.yml pull
docker compose -f docker-compose.peak.yml up -d
# Data in the peak-paperclip-data volume survives.
```

### Pin to a specific version

```sh
PAPERCLIP_IMAGE_TAG=sha-a1b2c3d docker compose -f docker-compose.peak.yml up -d
```

Every CI build publishes three tags: `latest`, the semver if tagged, and
`sha-<git-sha>` — always-pinnable.

---

## Deploy to Cloud (future)

The same `docker-compose.peak.yml` works on any cloud that can run a compose
file. Suggested targets, cheapest first:

### Fly.io (simplest)
```sh
flyctl launch --image ghcr.io/michaldanilczyk-ops/peak-paperclip:latest
flyctl volumes create peak_paperclip_data --size 10
flyctl secrets set BETTER_AUTH_SECRET=$(openssl rand -hex 32)
flyctl deploy
```

### Railway
Connect the GitHub repo, it auto-deploys on push to master. Add `BETTER_AUTH_SECRET` as a secret variable. Attach a volume at `/paperclip`.

### DigitalOcean / Hetzner / any VPS
```sh
ssh root@<host>
apt install docker.io docker-compose-plugin
# scp docker-compose.peak.yml to the host, then:
BETTER_AUTH_SECRET=... docker compose -f docker-compose.peak.yml up -d
```

### AWS ECS / GCP Cloud Run
Point at `ghcr.io/michaldanilczyk-ops/peak-paperclip:latest` as the image,
mount an EBS/Cloud Filestore volume at `/paperclip`, inject
`BETTER_AUTH_SECRET` via Secrets Manager.

---

## Security checklist before exposing publicly

- [ ] `PAPERCLIP_DEPLOYMENT_EXPOSURE=public` only if behind auth
- [ ] `PAPERCLIP_PUBLIC_URL` set to the actual public URL (powers origin guard)
- [ ] `BETTER_AUTH_SECRET` set to 32 random bytes — never hardcoded
- [ ] TLS termination at a reverse proxy (Caddy, Cloudflare, Tailscale Funnel)
- [ ] Volume `peak-paperclip-data` backed up — it contains your Postgres data
- [ ] `GITHUB_PAT` for GHCR pull scoped to read:packages only
- [ ] Upgrade cadence planned: pull + up every 1-2 weeks, or pin to semver

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker pull` → `denied` | `docker login ghcr.io` with a GitHub PAT (`read:packages` scope) |
| UI loads but login loops | `BETTER_AUTH_SECRET` changed or missing — restore original value |
| `port 3100 in use` | Stop any other service on 3100 (Peak OS for example) or set `PAPERCLIP_PORT=3101` |
| Data gone after upgrade | You deleted the `peak-paperclip-data` volume. Only remove it intentionally. |
