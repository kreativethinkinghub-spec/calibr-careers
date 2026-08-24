# calibr-careers.tech — DNS setup (point the domain at Render)

**Do this AFTER the Render service exists.** Create the service first (Render → New → Blueprint → `calibr-careers`), then in the service go to **Settings → Custom Domains** and add both `calibr-careers.tech` and `www.calibr-careers.tech`. Render then shows the **exact** records to create — those Render values are authoritative; the ones below are the standard defaults.

---

## The two records to create at your registrar / DNS host

| # | Type | Host / Name | Value (target) | TTL |
|---|------|-------------|----------------|-----|
| 1 | **CNAME** | `www` | `calibr-app.onrender.com` | Auto / 3600 |
| 2 | **ALIAS** (or ANAME) | `@`  (the apex / root) | `calibr-app.onrender.com` | Auto / 3600 |

- Record 1 sends **www.calibr-careers.tech** to the app.
- Record 2 sends the **root** `calibr-careers.tech` to the app.

### If your registrar can't do ALIAS/ANAME on the apex
Use an **A record** instead for record 2:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| **A** | `@` | *(the IP Render shows — Render's anycast IP, typically `216.24.57.1`)* | 3600 |

Always copy the exact IP from Render's Custom Domains screen — don't assume.

---

## Order of operations (so SSL works)
1. Create the Render service (blueprint).
2. Add **both** domains in Render → Settings → Custom Domains.
3. Create the DNS records above at your host.
4. Back in Render, the domains flip to **Verified** (a few minutes to ~an hour as DNS propagates).
5. Render auto-issues a **free SSL certificate** — no action needed. `https://calibr-careers.tech` goes live.

## Pick a primary (recommended)
Serve one canonical URL and redirect the other. In Render's Custom Domains you can set `www` to **redirect to** the apex (or vice-versa). Apex (`calibr-careers.tech`) as primary is the common choice.

---

## Registrar notes
- **Cloudflare (as DNS host):** add the records as above, but set the proxy to **DNS only** (grey cloud, not orange) so Render can issue SSL. Orange-cloud/proxied will break Render's cert.
- **GoDaddy / Namecheap / most registrars:** use their DNS panel; if "ALIAS/ANAME" isn't offered for `@`, use the **A record** option.
- **.tech registrar (Radix / your reseller):** same records; look for "Manage DNS" / "DNS records".

## After it resolves — set these in the app / providers
- Google/Paystack/LinkedIn callbacks all use the apex now:
  - Paystack webhook: `https://calibr-careers.tech/paystack/webhook`
  - OAuth redirect: `https://calibr-careers.tech/oauth/callback`

## Quick verification
```bash
# DNS resolves to Render?
nslookup www.calibr-careers.tech
nslookup calibr-careers.tech
# App answering + healthy?
curl -I https://calibr-careers.tech/
```
Expect the app's landing (HTTP 200) once DNS + SSL are live.
