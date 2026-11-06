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
document type). `vv-residency-*` cover the worker-added "proof of where you
live" item: a current Tennessee bill passes, a New York bill or a 2025 bill
fails. They live only in the repo (not served by the app): download
them from GitHub or the checkout and upload them through the hosted flow.
Regenerate with `npm run test-documents` (needs Chrome for the PDF/PNG render).

## CLEAR coverage discovery (demo)

CLEAR's identity check can also return the person's health coverage
(`traits.health_insurance`). CLEAR's sandbox never does, so — like the
`DEMO_COVERAGE_SCENARIO` overlay in the State-X and Georgia CLEAR demos —
`CLEAR_DEMO_COVERAGE` overlays a deterministic record on **household**
identity checks (providers verify identity only):

| Setting | Effect |
|---|---|
| `CLEAR_DEMO_COVERAGE=medicaid` | Active Medicaid with `CLEAR_DEMO_COVERAGE_STATE`'s program (default `NY` → "New York Medicaid"). When that state differs from `STATE_CODE` the worker sees an **out-of-state Medicaid / possible duplicate enrollment** finding; the household sees a plain-language notice that more information may be requested. |
| `CLEAR_DEMO_COVERAGE=employer_plan` | Active Aetna employer plan held by a spouse → third-party-liability note only. |
| unset / `off` | Only what CLEAR actually returned (nothing in sandbox or simulation). |
| `CLEAR_DEMO_COVERAGE_STATUS`, `_MEMBER_ID`, `_START` | Fine-tune the record (`ACTIVE`, `NY48213579`, `2025-11-01`). |

The record is labelled **Demo overlay** in the console and `/api/config` and
Demo settings show the active scenario. Never enable it on a real deployment.

## Worker-added verifications

The case data derives the initial checklist, but the worker decides what else
to ask for. On any request that is not yet verified, **Add a verification**
(review header, or the shortcuts on a coverage finding) adds an item as
*Needed*: pick a preset (proof of residency, proof other coverage ended,
citizenship/immigration status, more income proof, child-care expenses; for
providers a license, liability insurance, board certification, W-9) or write
a custom one, choose who it is for, whether it is required, and which instant
checks to allow besides upload. Facts from the case (name, address, agency
state) are attached so the AI first pass checks the document against them.
Before submission the item simply appears on the hosted checklist; after
submission **Return for corrections** sends a new secure link with it.

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
