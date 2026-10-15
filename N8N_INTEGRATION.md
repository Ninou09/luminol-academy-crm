# n8n inquiry automation

Workflow: [Luminol CRM - New inquiries and follow-up tasks](https://n8n.185-199-158-53.sslip.io/workflow/gZyH8tkMBos4vtAB), published and active in the owner's **personal n8n project**. The matching intake credentials are configured, live delivery and replay protection are verified, and the five-minute polling path has completed successfully.

## Behavior

Every five minutes, the workflow reads new rows from the existing `luminol_leads` table. The initial cutoff is **15 October 2026, 16:10 Europe/Volgograd / 13:10 UTC**. It uses n8n's automatic `createdAt` field, so editing an older row does not backfill it. Only explicit consented inquiries are eligible. Opt-outs, do-not-contact records, QA records, and existing conversions/bookings are excluded.

The workflow sends a small allowlisted payload to the production CRM. Names, email/phone, language, consent, service/program interest, source, campaign, source row ID, and creation time are included. Notes, raw metadata, payment details, health details, and existing follow-up messages are not copied. The source table is never modified by this workflow.

The CRM creates an **incoming inquiry** and an assigned **review task**, due within 24 hours. The receiving staff member defaults to the first administrator; optionally configure `N8N_INTAKE_OWNER_ID` with an administrator/admissions user ID. Open **Admissions → Incoming from n8n**, use Refresh to load arrivals, and review the correct program and advisor. Phone-only inquiries can be captured; a new contact needs an email confirmed during review. Contact matches preserve existing details and consent. Existing open opportunities and tasks are reused where possible. An enrolled opportunity is not restarted.

Only after the CRM confirms a durable save does n8n write an ID-only receipt to the new `luminol_crm_sync_receipts` table. The CRM also deduplicates by stable source row ID, so a lost response or failed receipt write cannot create a second inquiry/task on retry. Changed payloads for an already-seen source ID return 409 for review. No email, SMS, Telegram or WhatsApp message is sent.

This is **new-inquiry intake**, not a two-way synchronization. Later edits and opt-outs on already imported source records are not propagated by this first workflow; review those changes in the CRM before using any future outbound integration. Existing source workflows remain responsible for their current capture logic.

## One-time credential setup

1. Create a unique random token of **32–256 characters**; 64 random letters and numbers are recommended. Keep it in your password manager. Paste only the token value into each secret field, without a variable name, quotes, or surrounding JSON. This is separate from the administrator password.
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
- The owner saved the same valid private key as the Vercel Production Secret and the **Luminol CRM Intake** credential. Secrets were not printed in chat, committed, or placed in workflow parameters. The credential is assigned to the HTTP node.
- Production redeployment `dpl_85DLj3RS2qM6F1XgSh5y5J46Wrzp` was reported Ready. The authenticated inbox now reports **Ready to receive**. The earlier fictional Cloud Verification Sample and login session remain available.
- Live manual execution **3174** succeeded at **17:13 Europe/Volgograd / 14:13 UTC** on 15 October 2026. The CRM durably acknowledged inquiry **1** and review task **10**, and n8n saved receipt **1** for `n8n-connection-check:v1`.
- Live replay execution **3175** succeeded and returned `replayed=true` with the same inquiry/task IDs. The receipt was updated in place; no duplicate inquiry or task was created.
- The production admissions inbox shows **n8n Connection Sample**. **My tasks** shows exactly one **Review incoming n8n inquiry #1**, due within 24 hours; its Review inquiry action opens the inbox. This fictional record remains pending for demonstration, with communication consent disabled.
- The workflow was published with active version `75746a6e-0c40-4025-a2b1-a4fc7a7b558e`. Both the connector and n8n's **Published** badge confirm activation. A manual run from **Every five minutes** completed the source/preparation path successfully at **17:16 Europe/Volgograd**, with no unacknowledged eligible inquiry passed to delivery.
- Successful/error/manual execution payload retention is disabled for normal operation. It was temporarily enabled for fictional connection tests only; their retained payloads contain the fictional sample and a redacted Authorization header. Retention was disabled again before publishing and before running the actual lead-table polling path.
- Earlier invalid-length key diagnostics are resolved. The server distinguishes missing and invalid-length settings without returning the secret or its length.

The reproducible Workflow SDK source is `integrations/n8n-new-inquiries.ts`. The JSON/source templates intentionally import as an inactive workflow so credentials can be configured and tested before publishing a copy. If recreating it, also apply the privacy settings: `saveDataSuccessExecution=none`, `saveDataErrorExecution=none`, `saveManualExecutions=false`, `saveExecutionProgress=false`, `executionTimeout=120`, and `timezone=Africa/Algiers`.
