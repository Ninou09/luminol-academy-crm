# Verification report

Verified on 15 October 2026 in the delivered local Windows workspace.

## Automated checks

`npm run build` passes TypeScript checking and generates the production application.

`npm test`: **17 tests passed, 0 failed**. Each run uses isolated databases rather than the preview database.

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
- Checked the n8n setup dialog in the UI. It correctly reported that no adapter or credentials are configured and that no external request was sent.
- Saved desktop and Arabic mobile preview screenshots alongside this report.

## Hosted deployment checks

- The private GitHub repository is connected to the Vercel project in team `luminol`.
- Initial production deployment `dpl_C3GnC8aSYAjSGt7CQQ2fkxaQTC66`, from commit `af59a2c`, was reported Ready by Vercel.
- The production HTTPS URL loaded the English/Arabic sign-in interface, without a prefilled password or local demo role selector.
- Deployment settings confirmed Node.js 24.x, the cdg1 function region, and Standard Protection.
- A private Blob store in cdg1 is connected to this project's Production and Preview environments using OIDC.
- The backend refused startup while the required administrator password was absent, displaying the expected unavailable message. Owner password setup and a subsequent redeployment are pending; hosted sign-in and real storage persistence have not yet been verified.

## Limits of verification

This verifies a functional local release with demo records and a published hosted interface. No live email, WhatsApp, n8n, external calendar, form provider, or payment processor was connected. No money was moved. Hosted sign-in and persistence verification, production account onboarding, unattended automation scheduling, load testing, and an independent security/accessibility audit have not been completed.

A read-only search for existing Luminol workflows was attempted through the connected n8n tool. The connector returned an internal error, so existing remote workflows could not be inspected. No remote workflows were modified.

See README.md for the full list of remaining production work and assumptions.
