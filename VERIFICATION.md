# Verification report

Verified on 15 October 2026 in the delivered local Windows workspace.

## Automated checks

`npm run build` passes TypeScript checking and generates the production application.

`npm test`: **23 tests passed, 0 failed**. Each run uses isolated databases rather than the preview database.

1. Authentication, invalid passwords, and cross-origin write rejection.
2. Inquiry → advisor assignment → follow-up → consultation → enrollment → payment, including updated occupancy, contact reuse, financial balance, and audit history.
3. Duplicate email and normalized phone detection; safe reuse for another program.
4. Full-cohort rejection and idempotent waitlisting without charges or enrollment.
5. Payment retry deduplication, changed-payload key rejection, overpayment prevention, partial refunds, and over-refund prevention.
6. Instructor data scope, restricted notes, direct-record access, document access, and CSV exports.
7. Read-only manager write rejection; finance/admissions separation.
8. Stale opportunity versions and enrolled-stage shortcuts rejected.
9. Recurring calendar conflicts roll back; instructor attendance requires cohort assignment.
10. Installment splitting preserves exact minor-unit totals and original currency.
11. Unconfigured integration checks produce actionable errors; internal rule executions deduplicate; outbound messages remain drafts.
12. Consent is required for outbound drafts; document contents persist and downloads enforce scope.
13. Program price edits preserve old charges; role changes revoke sessions; last-admin and instructor-assignment safeguards.
14. Bulk follow-ups are atomic and retries do not duplicate tasks.
15. Hosted snapshots survive independent request connections; a failed conditional write is never acknowledged as saved.
16. Parallel simulated function instances cannot overwrite one another. The losing response is 409 and discards its login cookies.
17. A storage outage returns 503 with no false save confirmation.
18. n8n workflow normalization excludes opt-outs, historical records, conversions, and QA records; private notes and raw metadata do not leave the source item.
19. Dedicated intake credentials cannot access browser APIs; session credentials alone cannot submit service intake, and foreign origins are rejected.
20. Repeated intake deliveries create one review task; changed data for an existing source ID returns 409, and restricted staff roles cannot view the inbox.
21. Phone-only intake supports Algerian/Arabic phone normalization and requires email confirmation before creating a new contact; repeat review does not duplicate records/tasks.
22. Existing manual contact details and consent survive an intake match; enrolled opportunities are reused rather than restarted.
23. Malformed inquiry input is rejected without creating records or tasks.

The n8n inbox and review form were checked in an isolated browser database. The workflow passed schema validation and a simulated execution with HTTP pinned and receipt writes in dry-run mode. After correcting the Production Secret, live executions **3174/3175** succeeded with actual HTTP delivery, durable saves, receipt writing, and replay protection. The five-minute workflow is now published and active. See **N8N_INTEGRATION.md**.

## Browser checks

- Signed in successfully using the demo administrator account.
- Created the fictional Samia Khelifi inquiry using the UI, including communication consent.
- Opened its contact drawer and recorded consultation notes.
- Enrolled the contact in Psychology · Autumn. Cohort occupancy changed from 4/12 to 5/12; confirmed enrollments changed from 16 to 17.
- Recorded a 12,000 DZD manual payment against 36,000 DZD tuition. The profile and overview reflected 24,000 DZD remaining on that charge.
- Reloaded the application and restarted the server using the supplied launcher. The login session, contact, enrollment, and payment records survived.
- Switched the interface to Arabic. The page changed to RTL with translated navigation, forms, actions, and currency formatting.
- Checked the phone breakpoint at a 390 × 844 viewport. The visible content width equaled the document scroll width: no horizontal page overflow. The admissions table scrolls within its own container.
- Opened mobile navigation, visited Admissions, changed to table view, and filtered for Samia. The correct single enrolled contact remained.
- Bundled English and Arabic fonts locally; removed the external font stylesheet dependency.
- Visited Students, Programs & Cohorts, Calendar, Payments, Reports, and Settings at desktop width. Their page headings rendered successfully; the browser reported no console errors during these checks.
- During the initial local demo, the n8n setup dialog correctly reported that no adapter or credentials were configured. The later hosted connection and automation were verified separately below.
- Saved desktop and Arabic mobile preview screenshots alongside this report.

## Hosted deployment checks

- The private GitHub repository is connected to the Vercel project in team `luminol`.
- Initial production deployment `dpl_C3GnC8aSYAjSGt7CQQ2fkxaQTC66`, from commit `af59a2c`, was reported Ready by Vercel.
- The production HTTPS URL loaded the English/Arabic sign-in interface, without a prefilled password or local demo role selector.
- Deployment settings confirmed Node.js 24.x, the cdg1 function region, and Standard Protection.
- A private Blob store in cdg1 is connected to this project's Production and Preview environments using OIDC.
- The owner saved the administrator password as a Secret for Production and Preview. Its value was not retrieved or exposed.
- Production redeployment `dpl_9NPe2XVoNinVkURcrrLhQxFvtsZQ`, from commit `7fcd207`, was reported Ready. The storage-unavailable message is resolved.
- The owner signed in as the hosted administrator; the authenticated workspace loaded successfully.
- Created the fictional **Cloud Verification Sample** inquiry (`cloud-verification@example.test`). The opportunity count changed from 32 to 33, with a generated first-contact task and activity entry.
- After a full page reload, the login session, inquiry, follow-up, and activity entry remained available.
- The private Blob browser showed the production `workspace.sqlite` snapshot with a recent modification timestamp. The sample inquiry is retained as verification evidence; no external message or real transaction was involved.
- n8n intake redeployment `dpl_85DLj3RS2qM6F1XgSh5y5J46Wrzp`, from commit `6766d20`, was reported Ready after the matching secret was saved. The production admissions inbox shows **Ready to receive**. The earlier sample record and session survived the release.
- Live n8n execution **3174** created fictional intake **1** and assigned review task **10**; receipt **1** was written only after the CRM acknowledged the durable save.
- Replay **3175** succeeded with `replayed=true` and the same intake/task IDs. The receipt was updated in place. The production UI shows exactly one **n8n Connection Sample** and one **Review incoming n8n inquiry #1** task; its review link opens the inbox.
- The connector confirms the workflow is active, and the n8n editor shows **Published**. Active version: `75746a6e-0c40-4025-a2b1-a4fc7a7b558e`. A manual run from **Every five minutes** completed the lead-table preparation path successfully, with no unacknowledged eligible inquiry passed to delivery.
- Successful/error/manual payload retention was disabled before publication and the actual table read. Only the fictional diagnostic payloads were temporarily retained; authorization is redacted in those logs.

## Limits of verification

This verifies the local release, hosted administrator inquiry workflow, and live n8n intake, including durable saves and duplicate protection. No live email, WhatsApp, external calendar, new form provider, or payment processor was connected by this work, and no money was moved. Other hosted staff-role sessions, production account onboarding, unattended failure alerts, load testing, and an independent security/accessibility audit have not been completed. The published n8n schedule is active; its payloads are deliberately not retained during normal operation.

Existing source workflows were inspected but not changed. This first integration captures new eligible inquiries only; it does not propagate later source edits or opt-outs to existing CRM records. Staff still confirm program/advisor assignments before moving an intake into admissions.

See README.md for the full list of remaining production work and assumptions.
