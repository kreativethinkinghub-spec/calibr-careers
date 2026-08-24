# CALIBR — Deployment (one service on Render)

**Repo:** https://github.com/kreativethinkinghub-spec/calibr-careers (private)
**Blueprint:** `render.yaml` (repo root) provisions a **single** service — the app *is* the site.

| Service | From | What it is | Domain |
|---|---|---|---|
| `calibr-app` | `app/` | Node/Express + SQLite (1 GB persistent disk). Serves the **landing at `/`**, then signup / login / jobs / dashboards. | `calibr-careers.tech` + `www` |

The separate static marketing site has been **retired** — the app renders the landing itself (`app/landing.html`), so there's one product and one deployment. (`static-site/` stays in the repo for reference but isn't deployed.)

## 1. Create the service
1. **https://dashboard.render.com → New → Blueprint** → connect GitHub → pick **calibr-careers**.
2. Render reads `render.yaml` and creates `calibr-app` with a persistent disk (`npm install` → `npm start`).

## 2. Secrets (app service → Environment tab)
Set the ones marked `sync:false`:
- `OPENAI_API_KEY` — enables the AI rewrites / feedback (works deterministically without it)
- `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` — billing
- `LINKEDIN_CLIENT_ID` / `_SECRET` (optional) — LinkedIn connect
Preset already: `SESSION_SECRET` (auto), `NODE_ENV=production`, `DB_PATH=/data/calibr.db`, `ADMIN_EMAILS`.

## 3. Custom domain + DNS
Service → **Settings → Custom Domains** → add **`calibr-careers.tech`** and **`www.calibr-careers.tech`**. Render shows the exact records to create at your registrar:

| Type | Name | Value (Render provides the real target) |
|---|---|---|
| CNAME | `www` | `calibr-app.onrender.com` |
| ALIAS/ANAME (apex) | `@` | `calibr-app.onrender.com` |

(If the registrar can't ALIAS the apex, use Render's A record, or host DNS on Cloudflare set to **DNS-only**.)

## 4. After it's live
- **OAuth redirect URI:** `https://calibr-careers.tech/oauth/callback`
- **Paystack webhook:** `https://calibr-careers.tech/paystack/webhook`
- **Google for Jobs** auto-indexes the public `/jobs/:token` pages once on the real HTTPS domain.

## Redeploying
Push to `main` → Render auto-deploys.
```bash
git add -A && git commit -m "..." && git push
```

---
### Mine vs yours
- **Done (me):** repo + blueprint, app serves the landing, DB on persistent disk, Node pinned, secrets scaffolded, static site retired from deploy.
- **Yours:** connect Render to the repo, paste the secret keys, point `calibr-careers.tech` DNS.
