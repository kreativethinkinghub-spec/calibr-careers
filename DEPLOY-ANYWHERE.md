# CALIBR — deploy anywhere (no Render, no persistent disk)

The app now supports **Turso** (a SQLite-compatible cloud database). With Turso, the durable
data lives in the cloud and the app keeps only a local *replica* it reads/writes synchronously —
so **you no longer need a persistent disk**, and CALIBR can run on any Node host you like.

Nothing in the app code changed for you: set two environment variables and it switches automatically.
Leave them unset and it behaves exactly as before (local SQLite file).

---

## 1. Create a free Turso database (once, ~2 minutes)

**Option A — CLI**
```bash
curl -sSfL https://get.tur.so/install.sh | bash      # install the Turso CLI
turso auth signup                                    # or: turso auth login
turso db create calibr                               # create the database
turso db show calibr --url                           # -> TURSO_DATABASE_URL (libsql://...)
turso db tokens create calibr                        # -> TURSO_AUTH_TOKEN
```

**Option B — dashboard:** create a DB at **turso.tech**, then copy its **Database URL** and create an **auth token**.

Pick the region closest to your users when creating the DB.

---

## 2. Set environment variables on your host

Required for cloud storage:
```
TURSO_DATABASE_URL = libsql://calibr-<you>.turso.io
TURSO_AUTH_TOKEN   = <the token from step 1>
SESSION_SECRET     = <any long random string>
NODE_ENV           = production
```
Optional (activate features when ready):
```
ANTHROPIC_API_KEY or OPENAI_API_KEY     # AI copilots
PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY # billing (ZAR)
WHATSAPP_TOKEN, WHATSAPP_PHONE_ID        # WhatsApp (Meta)  — or TWILIO_SID/TWILIO_TOKEN/TWILIO_WHATSAPP_FROM
ADMIN_EMAILS = kreativethinkinghub@gmail.com
```
> You do **not** need `DB_PATH` or any mounted volume any more. The local replica lives in the container's
> own filesystem and re-syncs from Turso on boot.

---

## 3. Deploy the `app/` folder on any Node host

- **Runtime:** Node **22+** (24 recommended).
- **Build command:** `npm install`   (installs `libsql` from optionalDependencies — prebuilt binaries, no compiler needed on Linux/macOS/Windows x64/arm64)
- **Start command:** `npm start`
- **Root directory:** `app`

Works on **Fly.io** (has a Johannesburg region — best latency for SA), **Railway**, **Koyeb**,
**DigitalOcean App Platform**, a plain **VPS/container**, or **Vercel** (as a Node function). None of them
need a persistent volume any more.

Quick examples:
- **Fly.io:** `cd app && fly launch --now` (choose region `jnb`), then `fly secrets set TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… SESSION_SECRET=…`
- **Railway:** New Project → Deploy from GitHub → set Root Directory to `app`, add the env vars above.
- **Koyeb / DO App Platform:** connect the repo, Root `app`, build `npm install`, run `npm start`, add env vars.

---

## 4. First-run checks

```bash
curl -I https://<your-host>/            # expect 200 (landing)
curl    https://<your-host>/try         # expect the free ATS demo (200)
```
Then sign up an employer, post a role, and confirm it persists across a redeploy (that proves Turso is the
source of truth). To pre-fill demo data: run `node seed.js` once (writes through the replica to Turso).

---

## Notes
- The app auto-detects the backend at boot: `TURSO_DATABASE_URL` present → Turso; absent → local `node:sqlite`.
- Read-your-writes consistency is on by default, so signup-then-read works correctly.
- Multiple app instances all sync to the same Turso DB (eventual consistency within ~15s); for a single
  instance it's immediately consistent.
- Point your domain (`calibr-careers.tech`) at whichever host you choose — in Cloudflare, a CNAME (DNS-only)
  to the host, exactly like before.
