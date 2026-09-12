# Deploying to Vercel

This app was written as one long-lived Express server. Vercel runs serverless
functions. `server/app.ts` is what makes both possible: it builds the Express
app without touching the filesystem or binding a socket, and two entry points
use it.

```
server/index.ts   node process — Vite in dev, dist/public in prod, listens on PORT
api/index.ts      Vercel function — one function for the whole API, no static files
vercel.json       vite build → dist/public, /api/* rewritten to the function
```

Everything else — the client — is static, built by `vite build` and served off
the CDN. The SPA rewrite in `vercel.json` sends every non-`/api` path to
`index.html` so wouter's client-side routes survive a hard refresh.

## Project settings

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Build command | `vite build` (from `vercel.json`) |
| Output directory | `dist/public` |
| Production branch | Settings → Git → Production Branch |

Changing the production branch does **not** trigger a build. Redeploy from the
Deployments tab afterwards.

## Environment variables

Set these on the Production environment before the first deploy.

```
SESSION_SECRET              random, 32+ bytes. Unset falls back to a literal in this repo.
REDIS_URL                   NOT optional here — see Sessions below
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL                the Supabase POOLER uri, port 6543
ENCRYPTION_KEY
PUBLIC_URL                  the deployed origin, for KYC file_path urls sent to ITD
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET     separate from the API secret
ITD_COMPANY_ID / ITD_EMAIL / ITD_PASSWORD / ITD_CUSTOMER_CODE / ITD_API_COMPANY_ID
OPENAI_API_KEY              optional, support chat only
```

**Leave unset:** `OTP_DEV_BYPASS` (accepts any code for any phone number) and
`PAYMENTS_TEST_MODE` (marks orders paid with no money moving — and unlike the
OTP bypass it is honoured in production builds).

## Four things that differ from a normal server

**Sessions need Redis.** Without `REDIS_URL` the store is `MemoryStore`, which
lives in one container. Serverless gives you a different container whenever it
feels like it, so users are signed out at random. `createApp` warns at boot when
production has no store, but the warning is not a fix. Upstash is the usual
answer.

**Postgres needs the pooler.** Every cold container opens its own `pg` pool. The
direct Supabase connection string runs out of connections; the pooler URI on
port 6543 exists for this.

**Uploads are capped at 4MB.** Vercel rejects a serverless request body over
4.5MB before the function runs, which surfaces as a bare 413 with no JSON body.
`kycUpload` is set to 4MB so the error is ours and says something useful. If
this ever moves back to a long-lived host, raise it in `server/routes.ts` and in
`client/src/components/KycUpload.tsx` together.

**`NODE_OPTIONS=--import=./server/dns-ipv4first.mjs` does not carry over.** The
`start` script sets it; the function does not. `server/app.ts` calls
`setDefaultResultOrder("ipv4first")` itself, which covers the same ground for
anything resolved after the module loads.

**BIA reads files from `content/`.** The app guide (`content/bia/app-guide.md`) and the restricted-items lists are read from disk at runtime, which the function bundler cannot trace, so `vercel.json` lists them in `includeFiles`. A new folder under `content/` is covered by the same glob.

## Before real users

`sendOtpSms` in `server/otp.ts` logs the code to the server console — there is
no SMS provider. Phone is the only credential, so on a public deploy **nobody
can sign in**, and `OTP_DEV_BYPASS` must not be used to paper over it: it
accepts any code for any number. Wiring a provider is the blocking piece of
work, not the deploy.
