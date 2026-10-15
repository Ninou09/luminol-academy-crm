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

The owner must set `DEMO_PASSWORD` as a **Secret**, scoped to Production and Preview, with a unique password of at least 16 characters. The Vercel form has been prepared for this step. Do not send the password in chat or commit it. Redeploy after saving the environment variable.

The hosted administrator is `admin@luminol.demo`. Cloud startup refuses to initialize without the password. The initial deployment therefore displays a storage-unavailable message until the secret and linked-store settings are included in a new deployment. Changing this environment variable later does not reset an existing account password.

Pending hosted checks after setup: sign-in, fictional inquiry creation, persistence after reload, and reading the record in another session. These checks have not yet been claimed as passed. The local build and all **17 automated tests** pass, including simulated independent function instances, conflicting writes, and storage outages.

## Operational boundaries

The database contains fictional sample records. Real staff invitations, password recovery, backup procedures, and external service integrations remain follow-up work before operational use with real student records. The snapshot adapter is intended for this small release and has a 64 MB database limit; use managed SQL as data volume and concurrent usage grow.

Local databases, secrets, runtime files, dependencies, and build output are excluded from Git. No local database or private credentials were uploaded to GitHub.
