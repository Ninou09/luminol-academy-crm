# Deployment status

## Published source and hosting

- Private GitHub repository: https://github.com/Ninou09/luminol-academy-crm
- Production URL: https://luminol-academy-crm.vercel.app/
- Vercel dashboard: https://vercel.com/luminol/luminol-academy-crm
- Team: `luminol` (`team_aI1mjk4mAzJS5FWTApMZNBJR`).
- Project: `luminol-academy-crm` (`prj_EPTXe3bLOVUphpjWxj2IbPnzWvJR`).
- Production branch: `main`; pushes trigger Vercel builds.

On 15 October 2026, the Vercel dashboard reported the initial production deployment `dpl_C3GnC8aSYAjSGt7CQQ2fkxaQTC66` as **Ready**, built from commit `af59a2c46d79b6f0a6ffec3d088d56b6abefc2d8`. The HTTPS interface loaded successfully. Its deployment settings showed Node.js **24.x**, function region **cdg1**, Fluid Compute enabled, and Standard Protection.

## Durable storage

A **private** Vercel Blob store named `luminol-academy-crm-blob` (`store_i21F9Y771Jzl5Lvu`) was created in **Paris / cdg1** and connected only to this CRM project's Production and Preview environments. Vercel injected `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY`; the connection uses short-lived OIDC authentication. No long-lived read-write token environment variable was added.

Production and preview branches use separate database snapshot paths. Writes compare the previous ETag to prevent silent concurrent overwrites. Responses and login cookies are buffered until persistence succeeds. Storage failures return 503; conflicting saves return 409. Temporary files are never treated as durable storage.

## Administrator setup and verification

The owner saved `DEMO_PASSWORD` as a **Secret** in both Production and Preview. Its value was not retrieved, printed, or committed. Production was redeployed with the latest environment settings; deployment `dpl_9NPe2XVoNinVkURcrrLhQxFvtsZQ`, from commit `7fcd207bc61592fb9bfd9c2d26dc8e01929888d9`, was reported **Ready** on 15 October 2026.

The hosted administrator is `admin@luminol.demo`; use the password saved by the owner. Cloud startup refuses to initialize without a password of at least 16 characters. The previous storage-unavailable message is resolved. Changing this environment variable later does not reset an existing account password.

Verified against the production URL: the owner signed in successfully, the authenticated workspace loaded, a fictional inquiry named **Cloud Verification Sample** was created, and the record, generated follow-up, activity history, and login session survived a full page reload. Vercel's private Blob browser showed `luminol-crm/production/workspace.sqlite` with a recent modification timestamp. No real contact was created or message sent. The sample inquiry is intentionally retained as verification evidence.

The local build and all **23 automated tests** pass, including simulated independent function instances, conflicting writes, storage outages, and the n8n intake permission/idempotency boundaries. Hosted verification covers the administrator, original inquiry workflow, and n8n intake. Hosted load tests and other staff-role sessions have not been claimed as completed.

## Live n8n inquiry automation

The intake endpoint and bilingual inbox are deployed in production. After the owner saved matching credentials, redeployment `dpl_85DLj3RS2qM6F1XgSh5y5J46Wrzp`, from commit `6766d20`, was reported **Ready** on 15 October 2026. The authenticated admissions page reports **Ready to receive**, and the earlier sample record and session remain available. The initial invalid-length key issue is resolved; secrets were kept out of source, workflow parameters, and chat.

Workflow [Luminol CRM - New inquiries and follow-up tasks](https://n8n.185-199-158-53.sslip.io/workflow/gZyH8tkMBos4vtAB) is **published and active** in the owner's personal n8n project, with a five-minute schedule and academy timezone `Africa/Algiers`. Its active version is `75746a6e-0c40-4025-a2b1-a4fc7a7b558e`. Existing source workflows were not changed.

Live execution **3174** created fictional intake **1**, assigned review task **10**, and receipt **1**. Replay **3175** returned the same IDs with `replayed=true`. The production inbox and **My tasks** show one sample and one linked review task. The actual lead-table preparation path also completed successfully. Payload retention was disabled before publishing and before the real table read; temporarily retained diagnostics contain only the fictional connection sample with redacted authorization.

New consented source rows from 15 October 2026 at 16:10 Europe/Volgograd are eligible. Staff review the program and advisor in **Admissions → Incoming from n8n** before adding an inquiry to the pipeline. This workflow sends no outbound messages. See **N8N_INTEGRATION.md** for setup, filtering, replay protection, and operating details.

## Operational boundaries

The database contains fictional sample records. Real staff invitations, password recovery, backup procedures, and external service integrations remain follow-up work before operational use with real student records. The snapshot adapter is intended for this small release and has a 64 MB database limit; use managed SQL as data volume and concurrent usage grow.

Local databases, secrets, runtime files, dependencies, and build output are excluded from Git. No local database or private credentials were uploaded to GitHub.
