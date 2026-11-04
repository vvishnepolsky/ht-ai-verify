# AI Verify

Verification collection with an AI first pass, for two kinds of subjects:

1. **Households that applied for benefits.** The worker sees the case data and
   the verifications it requires (identity, income, assets, housing, utilities,
   medical bills), texts the primary contact a secure link, and the household
   provides each item by photo, file upload, or an instant check — CLEAR for
   identity, Argyle for payroll income and bank balances.
2. **Medicaid providers.** The worker sees the provider's name, NPI, type,
   credentials and licenses, runs the automatic CMS NPI Registry check, and
   emails a secure link. The provider uploads a photo ID, current licenses,
   board certifications and a certificate of insurance.

Every upload gets an AI first-pass review (right kind of document, legible,
whose it is, still in effect, agrees with what the application says). The
worker then approves each item, rejects with a note, returns the whole
request for corrections (which rotates the link and re-notifies), or marks it
verified. The workflow, lifecycle and Hearth styling are ported from
`ht-cre`'s Case Readiness Engine (`interview-service` + `cre/admin` +
`cre/resident`), reduced to a single Node service.

## Run locally

```bash
npm install
cp .env.example .env     # add keys as you have them; everything is optional
npm run build
npm start                # http://localhost:4040  (console)  /flow?token=… (hosted flow)
```

`npm run dev` (tsx watch) + `npm run dev:web` (Vite on :5191, proxying the
API) for development. Without `DATABASE_URL` the store is in-memory; without
`OPENAI_API_KEY` uploads are stored unanalyzed; without Twilio/email the
console shows the link for manual sharing; without CLEAR/Argyle credentials
those paths run a clearly-labelled simulation.

## Test documents

`docs/test-documents/` holds synthetic pass/fail documents for the seeded
Jordan Reyes household and Elena Vasquez, MD provider — one pair per
verification item, identical except for the single thing the AI should catch
(expired term, wrong person, wrong employer, wrong license number, wrong
document type). They live only in the repo (not served by the app): download
them from GitHub or the checkout and upload them through the hosted flow.
Regenerate with `npm run test-documents` (needs Chrome for the PDF/PNG render).

## Layout

```
server/
  index.ts                  http server: /api, /flow-api, /hosted, /test-documents, static
  env.ts  db.ts  http-utils.ts
  domain/   types.ts lifecycle.ts (pure reducers) derive.ts (tasks from case data) case.ts token.ts
  ai/       ocr.ts (vision review) match.ts (name/employer/taxonomy) openai.ts
  integrations/  npi.ts (NPPES) twilio.ts email.ts clear.ts argyle.ts
  services/ verification.service.ts   (send, review, return, hosted actions)
  api/      admin-api.ts flow-api.ts hosted.ts validate.ts
  demo/     seed.ts (synthetic households + providers)
web/src/
  console/  Console, Dashboard, CaseList, CaseDetail, ReviewPanel, dialogs
  flow/     FlowApp, TaskCard, CameraCapture
  styles.css (Hearth tokens)
```

## Deploy

`render.yaml` describes the service + Postgres. Secrets are set in the Render
dashboard (or copied from an existing deployment with the Render API).
