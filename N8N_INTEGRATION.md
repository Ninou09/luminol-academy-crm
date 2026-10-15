# n8n inquiry automation

Workflow: [Luminol CRM - New inquiries and follow-up tasks](https://n8n.185-199-158-53.sslip.io/workflow/gZyH8tkMBos4vtAB), created in the owner's **personal n8n project**. It is unpublished until the credential and live connection test are complete.

## Behavior

Every five minutes, the workflow reads new rows from the existing `luminol_leads` table. The initial cutoff is **15 October 2026, 16:10 Europe/Volgograd / 13:10 UTC**. It uses n8n's automatic `createdAt` field, so editing an older row does not backfill it. Only explicit consented inquiries are eligible. Opt-outs, do-not-contact records, QA records, and existing conversions/bookings are excluded.

The workflow sends a small allowlisted payload to the production CRM. Names, email/phone, language, consent, service/program interest, source, campaign, source row ID, and creation time are included. Notes, raw metadata, payment details, health details, and existing follow-up messages are not copied. The source table is never modified by this workflow.

The CRM creates an **incoming inquiry** and an assigned **review task**, due within 24 hours. The receiving staff member defaults to the first administrator; optionally configure `N8N_INTAKE_OWNER_ID` with an administrator/admissions user ID. Open **Admissions → Incoming from n8n**, use Refresh to load arrivals, and review the correct program and advisor. Phone-only inquiries can be captured; a new contact needs an email confirmed during review. Contact matches preserve existing details and consent. Existing open opportunities and tasks are reused where possible. An enrolled opportunity is not restarted.

Only after the CRM confirms a durable save does n8n write an ID-only receipt to the new `luminol_crm_sync_receipts` table. The CRM also deduplicates by stable source row ID, so a lost response or failed receipt write cannot create a second inquiry/task on retry. Changed payloads for an already-seen source ID return 409 for review. No email, SMS, Telegram or WhatsApp message is sent.

This is **new-inquiry intake**, not a two-way synchronization. Later edits and opt-outs on already imported source records are not propagated by this first workflow; review those changes in the CRM before using any future outbound integration. Existing source workflows remain responsible for their current capture logic.

## One-time credential setup

1. Create a unique random token of **32–256 characters**; 64 random characters are recommended. Keep it in your password manager. This is separate from the administrator password.
2. In the CRM Vercel project, add `N8N_INTAKE_TOKEN` as a **Secret for Production**, then redeploy.
3. In the workflow's **Capture inquiry and review task** node, create/select **Luminol CRM Intake** with **Simplified Custom Auth** (the credential type is `httpTemplatedCustomAuth`). Its header template is:

   ```json
   {"headers":{"Authorization":"Bearer {{api_key}}"}}
   ```

   Store the same secret in the **Luminol intake key** field, whose placeholder is `api_key`. The prepared form marks it as a required secret. Restrict the credential to `luminol-academy-crm.vercel.app` where the credential UI supports allowed domains. Do not put the secret in node parameters, the workflow source, Git, or chat.
4. Run the manual trigger **Test CRM connection with sample**. This sends only a fictional `n8n Connection Sample` record, with no communication consent, to the CRM. Re-running that test is idempotent.
5. Verify the sample in the CRM inbox and its review task. Publish the workflow after the live check passes. The schedule uses the academy zone, `Africa/Algiers`.

The endpoint is `POST https://luminol-academy-crm.vercel.app/api/integrations/n8n/inquiries`. The token authorizes only capture; it cannot sign in, read records, approve inquiries, or access other CRM APIs. The CRM and n8n communicate over HTTPS initiated by n8n; no new inbound connection to the Windows computer is required. The self-hosted n8n instance must stay running for polling to occur.

## Verification

- All **23 automated application/workflow-logic tests** pass, and the production frontend builds successfully.
- Isolated API tests cover credential scope, permission boundaries, invalid inputs, duplicate delivery, changed-payload conflicts, phone normalization, human review, preservation of existing consent, and enrollment reuse.
- An isolated browser check captured a fictional inquiry, selected a program/advisor, opened the resulting contact, and showed exactly one first-contact follow-up.
- n8n node/schema and workflow validation pass with no warnings.
- Simulated n8n execution **3163** succeeded with the HTTP response pinned and receipt writes in dry-run mode. The receipt table remained empty afterward; normal receipt writing was then restored.
- Successful/error/manual execution payload retention is disabled on this new workflow. It was briefly enabled for the fictional connection diagnostic **3166**, then disabled again. That retained diagnostic contains only the fictional sample and a redacted Authorization header.
- Production deployment `dpl_61KmX1RCj4aRVsu8CtNcreQmtwJf`, from commit `ded3612`, was reported Ready. Its authenticated admissions page shows the new inbox with zero pending inquiries and **Setup required**. The earlier fictional Cloud Verification Sample and the existing login session remain available.
- The owner saved the Production Secret and the **Luminol CRM Intake** credential. Their values were not retrieved or printed. The credential is assigned to the HTTP node.
- Production redeployment `dpl_DW1gTBiWzYmxiQDHFSpa5ETu37x1` and documentation deployment `dpl_DU4CNkDXj5JgU1PcBoMeRJ1GG1o9` (commit `5147be4`) were reported Ready. Live n8n connection diagnostic **3166** reached the CRM, which returned HTTP 503: **The n8n intake connection is not configured.** The receipt table remains empty and the inbox remains at zero. The server requires a runtime key of 32–256 characters; the owner is checking the saved key privately. Earlier attempt 3165 was not retained.
- Successful live delivery and activation remain pending. The workflow is unpublished, and the production data has not received the fictional connection record. Simulated tests do not prove a live connection.

The reproducible Workflow SDK source is `integrations/n8n-new-inquiries.ts`. If recreating it, also apply the privacy settings: `saveDataSuccessExecution=none`, `saveDataErrorExecution=none`, `saveManualExecutions=false`, `saveExecutionProgress=false`, `executionTimeout=120`, and `timezone=Africa/Algiers`.
