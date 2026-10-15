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

The local build and all **23 automated tests** pass, including simulated independent function instances, conflicting writes, storage outages, and the new n8n intake permission/idempotency boundaries. Hosted verification covers the administrator and the original inquiry workflow; hosted load tests and other staff-role sessions have not been claimed as completed.

The n8n intake endpoint and bilingual review inbox are deployed in production. Deployment `dpl_61KmX1RCj4aRVsu8CtNcreQmtwJf`, from commit `ded3612`, was reported **Ready** on 15 October 2026. The authenticated admissions page shows the new inbox with zero pending inquiries and **Setup required**, and the earlier fictional record and session remain available.

The new workflow is an unpublished draft in the owner's personal n8n project. The owner saved a separate `N8N_INTAKE_TOKEN` Production Secret and the **Luminol CRM Intake** n8n credential; neither value was retrieved or printed. The credential is assigned to the HTTP node.

Redeployment `dpl_DW1gTBiWzYmxiQDHFSpa5ETu37x1` and documentation deployment `dpl_DU4CNkDXj5JgU1PcBoMeRJ1GG1o9` (commit `5147be4`) were reported Ready. The fictional live check reached the CRM but returned HTTP 503 because the runtime intake key is missing or outside its 32–256-character requirement. No inquiry or receipt was created. The owner is checking the key privately; activation remains pending. See **N8N_INTEGRATION.md** for details.

After another private key check, production was redeployed as `dpl_Fa2Fi7nFkFhq9iKQLqKuNp56XLEj` (Ready). Diagnostic release `dpl_94zKC8uRu2oivVBb156dG7XrJT9v` (commit `450e096`, Ready) now distinguishes missing and invalid-length server settings without exposing values. Live check **3169** confirmed a **present but invalid-length** `N8N_INTAKE_TOKEN`. Both replacement forms are prepared for a fresh matching 64-character value. No production inquiry was created; the workflow remains unpublished. The build and all 23 tests pass.

## Operational boundaries

The database contains fictional sample records. Real staff invitations, password recovery, backup procedures, and external service integrations remain follow-up work before operational use with real student records. The snapshot adapter is intended for this small release and has a 64 MB database limit; use managed SQL as data volume and concurrent usage grow.

Local databases, secrets, runtime files, dependencies, and build output are excluded from Git. No local database or private credentials were uploaded to GitHub.
