# Luminol Academy CRM

A working local CRM for **psychology, languages, and training**, with an English/Arabic interface, Arabic right-to-left layouts, DZD defaults, and persistent SQLite storage.

## GitHub and Vercel

Source: [Ninou09/luminol-academy-crm](https://github.com/Ninou09/luminol-academy-crm). The repository is private. Vercel configuration is included in `vercel.json`; the frontend is built with Vite and `/api/*` is handled by a Node.js 24 function.

Hosted URL: [luminol-academy-crm.vercel.app](https://luminol-academy-crm.vercel.app/). See **DEPLOYMENT.md** for the verified deployment status and any remaining setup.

Administrator sign-in and cloud saving have been verified. Sign in with `admin@luminol.demo` and the password saved by the owner in Vercel. A fictional **Cloud Verification Sample** inquiry remains in the hosted workspace as evidence of the save-and-reload check.

The hosted version uses a **private Vercel Blob store** for durable SQLite snapshots. Each request opens its own temporary SQLite connection, reads the latest snapshot without CDN caching, and conditionally saves changed data using the previous ETag. A conflicting write returns HTTP 409 and does not claim success. Responses and login cookies are held until persistence succeeds. Preview branches use separate snapshots from production. Temporary function files are never treated as durable storage.

Required hosted environment variables:

- `BLOB_STORE_ID`: automatically injected when the private Blob store is linked to the Vercel project. Authentication uses Vercel's short-lived OIDC credentials.
- `DEMO_PASSWORD`: a unique password of at least 16 characters for the seeded hosted administrator. Configure this as a sensitive Vercel environment variable. Never commit it.

The hosted administrator email is `admin@luminol.demo`. Its password is not prefilled or bundled in the browser. Other seeded staff accounts receive independent random passwords on cloud initialization; the shared local demo password does not open those accounts. The hosted data remains clearly labeled as sample data until academy records are imported. Staff invitation and password-recovery flows remain future work.

The snapshot storage design is intended for this small academy release. It preserves relational transactions and rejects concurrent lost updates, but copies the database on requests and imposes a 64 MB snapshot limit. Move to managed SQL storage as volume or concurrent use grows. Hosted uploads are limited to 3 MB per file to remain within Vercel's request-body limit. Local uploads retain the 4 MB limit.

## Open the application

Double-click **Start-Luminol.cmd** or run:

```powershell
.\Start-Luminol.ps1
```

The launcher starts the local server in a hidden window and opens **http://127.0.0.1:4173**. If PowerShell scripts are restricted on your computer, use the terminal commands below without changing your system policy.

```powershell
npm ci
npm run build
npm start
```

Node.js 24 or newer is required. Dependencies and a production build are already present in this delivered workspace. The portable ZIP includes the build and source but excludes installed dependencies and runtime data; run `npm ci` after extracting it. Fonts are served locally, so the app does not need a font CDN at runtime.

The server listens on **127.0.0.1 only**. The local URL works on this computer; it is not a public deployment or a link other devices can use.

## Sign in

A new database starts **empty**: one administrator and no fictional records. Its email is `ADMIN_EMAIL` (default `admin@luminol.demo`) and its password is `ADMIN_PASSWORD` (or the older `DEMO_PASSWORD`). Locally, without either variable, the password is `LuminolAdmin!2026` — change it right away in **Settings → My account**.

The existing hosted workspace keeps its administrator and password. After the update, open **Settings → Data & import → Remove all sample data** to delete the old demo records (fake students, teachers, prices). Leads that came from the website / Google through n8n are kept and go back to **Requests → New leads**, where they can be accepted one by one or with **Import all**.

Staff are managed in **Settings → Team & permissions**: add advisors, teachers and psychologists, set or reset passwords, deactivate people who leave. Teachers do not need a login.

For automated tests or a local demonstration only, `SEED_SAMPLE_DATA=1` fills a new database with the old fictional sample.

## What works

- Overview with record-backed metrics, follow-ups, attention flags, sessions, pipeline stages, and recent activity.
- Admissions board and table, drag-and-drop stages, keyboard-accessible stage form, source/advisor filters, saved views, CSV exports, bulk assignment, and atomic bulk follow-ups.
- Contact deduplication by normalized email/phone, with explicit reuse for another opportunity.
- Student profiles, consultation notes, visibility-controlled notes, guardian/sponsor text, communication preferences, enrollment history, attendance, files, and payment records.
- Program creation and pricing edits, cohort creation, capacities, waitlists, same-program transfers, and completion tracking.
- Daily/weekly/monthly calendar, weekly recurring sessions, room/instructor/cohort conflict detection, cancellation, and attendance recording.
- Charges, discounts with reasons, installment splitting, manual partial payments, and refund records. Money is stored as integer minor units. Different currencies remain separate.
- Reviewable communication drafts and internal automation rules with deduplication and execution history. Nothing sends an external message or moves money.
- Role-based API authorization, scoped instructor records, restricted financial/admissions exports, hashed passwords, expiring HttpOnly sessions, cross-origin write protection, and an audit trail.
- English/Arabic controls, RTL layout, keyboard dialogs, mobile navigation, table pagination, global search, loading/error states, and unsaved-form protection.

## A complete workflow to try

1. Click **New inquiry**, choose a program and advisor, and save a fictional contact.
2. Open the contact from Admissions or global search (`Ctrl+K`).
3. Schedule a follow-up, record a consultation, and update the inquiry stage.
4. Choose **Enroll in cohort**. A full cohort offers a waitlist; enrollment reuses the contact and creates a tuition charge and onboarding task.
5. Open the profile's **Payments** tab and record a partial payment.
6. Verify the remaining balance, cohort occupancy, overview metrics, and activity history.

The workspace currently includes a fictional **Samia Khelifi** record created during browser verification: 36,000 DZD tuition, 12,000 DZD paid, and 24,000 DZD outstanding. It is demo data, not a real student or transaction. Fresh installations seed 32 fictional contacts and do not include this browser-created record.

## Persistence and development

The database is `data/luminol.sqlite`, with SQLite WAL files alongside it while the server is running. Uploaded documents and sessions are also stored in the database. Local storage holds only the interface language preference.

Use `npm run dev` for development with Vite middleware. `npm run build` performs TypeScript checking and builds the UI. `npm test` starts an isolated local server with a temporary database under the parent workspace's `work/verification` directory. Tests do not modify the delivered demo database.

For a consistent backup, stop the server before copying the entire `data` directory. Do not remove this directory unless you intend to discard all local records. There is no destructive reset button in the application.

## Assumptions and boundaries

- Confirmed by the owner: psychology, languages, training; Algerian dinars; English and Arabic.
- Defaults still to confirm: actual programs, prices, schedules, staff, logo, tuition rules, and whether psychology courses require special eligibility checks. All supplied program descriptions and prices are samples.
- `Africa/Algiers` is the editable academy time zone. Scheduling uses the academy zone rather than the browser's zone. Data-entry and history text remain in their original language; primary navigation, actions, and forms are bilingual. Server validation messages are currently English.
- n8n inquiry intake is **live and published**, reading new consented inquiries from the owner's existing n8n lead table every five minutes. Each delivery creates an inbox entry and an assigned review task; staff select the program/advisor before adding it to the pipeline. Live delivery and duplicate protection were verified with a fictional sample. See **N8N_INTEGRATION.md**. Other external integrations remain **Not configured**. Connection checks distinguish server configuration from actual delivery.
- Inquiry and enrollment task automations run when those records are created. Overdue, attendance, and installment-review rules run through **Settings → Automation history → Run internal rules**; those internal rules are not scheduled. The separate n8n intake workflow has its own five-minute schedule.
- The demo exposes a scoped workspace snapshot and paginates tables in the browser. Large deployments need server-side pagination and indexed search. This build does not claim enterprise-scale validation.
- Staff roles are assignable to the seeded accounts. Staff invitations, password resets, MFA/SSO, custom permission definitions, backups, retention policies, live multi-user notifications, and student self-service are future production work.
- SQLite integrity is enforced by foreign keys, checks, uniqueness, and transactions. Per-user access is enforced by the server; SQLite does not provide database-native row-level security here.
- Vercel hosting configuration now includes HTTPS cookies, persisted login-attempt limits, a password-protected application login, and private durable storage. Real staff provisioning, backups, and reviewed external integration adapters remain necessary before operational use with real student records.

See **ARCHITECTURE.md** for the data model and permissions, and **VERIFICATION.md** for tested behavior.

Implementation references: [React documentation](https://react.dev/learn), [Vite documentation](https://vite.dev/guide/), and [Node.js SQLite documentation](https://nodejs.org/docs/latest-v24.x/api/sqlite.html).
