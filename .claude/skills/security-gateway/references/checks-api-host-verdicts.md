<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# `api`, `host` and `verdicts` — the check recipes

Part of the skill `security-gateway`, checks 6 (`api`), 7 (`host`) and
8 (`verdicts`). SKILL.md holds when each check runs and what it needs; this
file holds the recipes. Severities and the format of a finding are defined in
SKILL.md.

## 6 · `api` — the endpoints that answer without a session

| Route | What it must do |
|---|---|
| `/api/ipn` | 403 on an invalid signature, always. Send it a payload with a broken `sha_sign` and watch. |
| `/api/chat` | signed-in only, and rate-limited or token-metered — it costs money per call |
| `/api/cron` | secret-guarded (`docs/cron.md`); an open cron endpoint is a free job runner |
| `/api/healthz` `/api/readyz` | public on purpose, and must leak nothing — no versions, no env, no DB error text |
| `/api/auth/*` | Auth.js. Do not modify; do check that nothing was |

Then the questions that apply to all of them, and to every server action:

- **Another member's id in the request** — does it come back with data?
  (**CRITICAL** if yes.) Try it: two accounts, one id, one session.
- **A method nobody thought about.** `DELETE` on a route that only implemented
  `GET` — Next.js returns 405 by itself, but a handler exported by accident does
  not. **HIGH.**
- **What comes back that should not.** `passwordHash`, an email that belongs to
  someone else, an internal id, a stack trace, a raw database error. Over-fetching
  is the quiet one: returning the whole row when the page shows a name.
  **MEDIUM**, **HIGH** with personal data.
- **Rate limits where they are missing.** `lib/rate-limit.ts` covers sign-in and
  address-change mails. Anything else a stranger can trigger repeatedly and that
  costs money or sends mail needs one too — chat above all. **MEDIUM**, and note
  the documented limitation: the limiter is per process, so several instances
  multiply every limit.
- **Error responses in production** say what went wrong, not where. A stack
  trace in a 500 body is **MEDIUM**.

## 7 · `host` — configuration and the live environment

- **Security headers.** `next.config.ts` sets `Referrer-Policy`,
  `X-Content-Type-Options`, `X-Frame-Options` and HSTS on every response. Check
  they are still there and actually arriving. There is deliberately
  **no CSP** — Next.js emits inline scripts, so a useful policy needs per-request
  nonces, and a `unsafe-inline` policy pasted in to look green is not protection.
  Its absence is a documented decision, not a finding.
  **Do not do this by hand:** `node run.mjs security-check --url https://…`
  asks the live domain for exactly these headers, the cookie flags and every
  `/dashboard` route with no session, and prints what each one is set to. The
  command is described in the skill's §7; do not restate its ratings here.
- **HTTPS everywhere**, `APP_URL` on `https://` **and equal to the domain
  customers actually use**, valid certificate. All four hosts in `docs/DEPLOY.md`
  do the certificate for you; verify rather than assume. `AUTH_URL` is derived
  from `APP_URL`, so one on the wrong domain is where every sign-in link points.
  🚨 **`AUTH_TRUST_HOST=true` is neither a finding nor a mitigation** — it says
  which `Host` values are accepted, never which origin the app hands out. If
  `AUTH_URL`/`NEXTAUTH_URL` is set at the host at all, ask why: it has to name
  the same origin as `APP_URL`, or the app will not start.
- **Secrets live in the host's secret store**, not in a committed file, not in
  the build image. `AUTH_SECRET` is different in production than locally.
- **`APP_ENV`** is `production` on the live instance. `lib/env-guard.ts` refuses
  to start there without a mail transport, without `APP_URL`, on a sender off the
  app's own domain and on `MEDIA_DRIVER=local` — those refusals are features, and
  a host that starts anyway is a host running an older image.
- **The database is not on the public internet** without a password and TLS, and
  the deploy runs migrations before the new version serves traffic
  (`docs/DEPLOY.md` → Migrations).
- **`/api/cron`'s secret is set** at the host, not left at its default.
- **Backups exist** and somebody has restored one at least once. Untested
  backups are **MEDIUM** the day before they are needed and CRITICAL the day
  after.

## 8 · `verdicts` — is the solution where the customer can read it?

1. **Read every entry's `load()`** and the client components under its
   panel: do the expected answers, the split, the correct options appear in
   anything the browser receives — including checkpoint verdicts and the
   resume `state`? (`state` ships to the client on the next load.)
2. **Search the built bundle.** `node run.mjs build`, then grep `.next/` for
   a known answer string of each element. 🚨 CRITICAL if found, naming the
   file and what a buyer does with it.
3. **The gates as registry fields.** `requiresPlan` present where the
   element is paid; `maxAttempts` where it judges; grading logic imported by
   any `"use client"` file is the same finding as 1.
