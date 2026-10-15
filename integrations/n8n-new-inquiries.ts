import { workflow, node, trigger, sticky, newCredential, splitInBatches, nextBatch, expr } from '@n8n/workflow-sdk';

const schedule = trigger({ type: 'n8n-nodes-base.scheduleTrigger', version: 1.4,
  config: { name: 'Every five minutes', position: [0, 0], parameters: {
    rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] }, misfirePolicy: 'coalesce_owner', misfireGraceSeconds: 1800,
  } }, output: [{ timestamp: '2026-10-15T13:10:00.000Z' }] });
const connectionTest = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1,
  config: { name: 'Test CRM connection with sample', position: [0, 360], parameters: {} }, output: [{}] });
const readLeads = node({ type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: { name: 'Read new lead rows', position: [240, 0], parameters: {
    resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'list', value: 'wvQxnbZERl9I4e0b', cachedResultName: 'luminol_leads' },
    matchType: 'allConditions', filters: { conditions: [{ keyName: 'createdAt', condition: 'gte', keyValue: '2026-10-15T13:10:00.000Z' }] },
    returnAll: true, orderBy: true, orderByColumn: 'createdAt', orderByDirection: 'ASC',
  } }, output: [{ id: 987654321, full_name: 'Automation Sample', email: 'n8n-sample@example.test', phone: '', consent: true, createdAt: '2026-10-15T13:10:01.000Z', service_type: 'training', course_interest: 'Program to confirm', metadata_json: '{}' }] });
const normalize = node({ type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Normalize eligible inquiries', position: [480, 0], parameters: {
    mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `
const out = [];
for (const [index, item] of $input.all().entries()) {
  const j = item.json;
  if (!Number.isSafeInteger(Number(j.id)) || Number(j.id) < 1) throw new Error('Source row has no stable row ID');
  let meta = {};
  if (j.metadata_json) {
    try { meta = JSON.parse(j.metadata_json); } catch { throw new Error('Review invalid metadata on row ' + j.id); }
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Review invalid metadata on row ' + j.id);
  }
  const state = [j.status, j.lifecycle_stage, j.next_action].join(' ');
  const flag = value => value === true || value === 1 || (typeof value === 'string' && /^(true|1|yes)$/i.test(value));
  if (j.consent !== true || flag(meta.opted_out) || flag(meta.do_not_contact) || flag(meta.is_test) || flag(meta.exclude_from_sales_metrics) || j.converted_at || flag(meta.payment_verified) || /declin|refus|unsubscrib|opt.?out|do_not_contact|not_interested|qa_test|paid|booked|enrolled|deposit/i.test(state)) continue;
  const submitted = String(j.createdAt || '');
  if (!Number.isFinite(Date.parse(submitted))) throw new Error('Review missing creation time on row ' + j.id);
  if (Date.parse(submitted) < Date.parse('2026-10-15T13:10:00.000Z')) continue;
  const name = String(j.full_name || '').trim();
  const email = String(j.email || '').trim().toLowerCase();
  const phone = String(j.phone || '').trim();
  if (!name || (!email && !phone)) throw new Error('Review missing contact fields on row ' + j.id);
  out.push({ json: {
    external_id: 'n8n-leads:' + j.id, name, email, phone, consent: true,
    language: meta.language === 'ar' || meta.language === 'العربية' ? 'العربية' : 'English',
    service_type: String(j.service_type || '').trim(), course_interest: String(j.course_interest || '').trim(),
    source: String(j.source || 'n8n').trim(), campaign: String(j.campaign || '').trim(), submitted_at: new Date(submitted).toISOString(),
  }, pairedItem: { item: index } });
}
return out;
` } }, output: [{ external_id: 'n8n-leads:987654321', name: 'Automation Sample', email: 'n8n-sample@example.test', phone: '', consent: true, language: 'English', service_type: 'training', course_interest: 'Program to confirm', source: 'n8n', campaign: '', submitted_at: '2026-10-15T13:10:01.000Z' }] });
const unsent = node({ type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: { name: 'Skip acknowledged source rows', position: [720, 0], parameters: {
    resource: 'row', operation: 'rowNotExists', dataTableId: { __rl: true, mode: 'list', value: 'kvs8R5L0sgGhect2', cachedResultName: 'luminol_crm_sync_receipts' },
    matchType: 'allConditions', filters: { conditions: [{ keyName: 'external_id', condition: 'eq', keyValue: expr('{{ $json.external_id }}') }] },
  } }, output: [{ external_id: 'n8n-leads:987654321', name: 'Automation Sample', email: 'n8n-sample@example.test', phone: '', consent: true, language: 'English', service_type: 'training', course_interest: 'Program to confirm', source: 'n8n', campaign: '', submitted_at: '2026-10-15T13:10:01.000Z' }] });
const sample = node({ type: 'n8n-nodes-base.set', version: 3.5,
  config: { name: 'Fictional connection check', position: [240, 360], parameters: {
    mode: 'manual', includeOtherFields: false, assignments: { assignments: [
      { id: 'test-id', name: 'external_id', type: 'string', value: 'n8n-connection-check:v1' },
      { id: 'test-name', name: 'name', type: 'string', value: 'n8n Connection Sample' },
      { id: 'test-email', name: 'email', type: 'string', value: 'n8n-connection@example.test' },
      { id: 'test-phone', name: 'phone', type: 'string', value: '' },
      { id: 'test-consent', name: 'consent', type: 'boolean', value: false },
      { id: 'test-language', name: 'language', type: 'string', value: 'English' },
      { id: 'test-service', name: 'service_type', type: 'string', value: 'training' },
      { id: 'test-course', name: 'course_interest', type: 'string', value: 'Connection verification - fictional record' },
      { id: 'test-source', name: 'source', type: 'string', value: 'n8n connection test' },
      { id: 'test-campaign', name: 'campaign', type: 'string', value: 'internal-verification' },
      { id: 'test-date', name: 'submitted_at', type: 'string', value: '2026-10-15T13:10:00.000Z' },
    ] },
  } }, output: [{ external_id: 'n8n-connection-check:v1', name: 'n8n Connection Sample', email: 'n8n-connection@example.test', phone: '', consent: false, language: 'English', service_type: 'training', course_interest: 'Connection verification - fictional record', source: 'n8n connection test', campaign: 'internal-verification', submitted_at: '2026-10-15T13:10:00.000Z' }] });
const deliver = node({ type: 'n8n-nodes-base.httpRequest', version: 4.5,
  config: { name: 'Capture inquiry and review task', position: [1200, 0], retryOnFail: true, maxTries: 3, waitBetweenTries: 1500,
    credentials: { httpTemplatedCustomAuth: newCredential('Luminol CRM Intake') }, parameters: {
      method: 'POST', url: 'https://luminol-academy-crm.vercel.app/api/integrations/n8n/inquiries',
      authentication: 'genericCredentialType', genericAuthType: 'httpTemplatedCustomAuth', sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr('{{ $json }}'),
      options: { timeout: 20000, response: { response: { responseFormat: 'json', neverError: false } }, redirect: { redirect: { followRedirects: false } } },
    } }, output: [{ ok: true, external_id: 'n8n-leads:987654321', intake_id: 1, task_id: 20, replayed: false }] });
const receipt = node({ type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: { name: 'Record acknowledged delivery', position: [1440, 0], parameters: {
    resource: 'row', operation: 'upsert', dataTableId: { __rl: true, mode: 'list', value: 'kvs8R5L0sgGhect2', cachedResultName: 'luminol_crm_sync_receipts' },
    matchType: 'allConditions', filters: { conditions: [{ keyName: 'external_id', condition: 'eq', keyValue: expr('{{ $json.external_id }}') }] },
    columns: { mappingMode: 'defineBelow', value: { external_id: expr('{{ $json.external_id }}'), intake_id: expr('{{ $json.intake_id }}'), task_id: expr('{{ $json.task_id }}'), synced_at: expr('{{ $now.toISO() }}') } }, options: { dryRun: false },
  } }, output: [{ id: 1, external_id: 'n8n-leads:987654321', intake_id: 1, task_id: 20 }] });
const batches = splitInBatches({ version: 3, config: { name: 'One inquiry at a time', position: [960, 0], parameters: { batchSize: 1 } } });
const instructions = sticky('## Setup before publishing\nStore the same 32+ character random token as Vercel Secret N8N_INTAKE_TOKEN and in the Luminol CRM Intake credential. Use templated custom auth with template {"headers":{"Authorization":"Bearer {{api_key}}"}} and store the secret in api_key. Redeploy the CRM. Run Test CRM connection with sample, then confirm the sample in Admissions. Publishing starts polling every five minutes. Only rows created from 15 October 2026 at 13:10 UTC are eligible. No historical backfill or outbound messaging. Notes, raw metadata, payment and health details stay in n8n. Only a confirmed CRM response is recorded as delivered. Keep this workflow unpublished until the credential and connection test pass.', [], { color: 5 });
export default workflow('luminol-new-inquiries-crm', 'Luminol CRM - New inquiries and follow-up tasks')
  .add(schedule).to(readLeads).to(normalize).to(unsent)
  .to(batches.onEachBatch(deliver.to(receipt).to(nextBatch(batches))))
  .add(connectionTest).to(sample).to(batches)
  .add(instructions)
  .group('Prepare new inquiries', [readLeads, normalize, unsent], { description: 'Reads new source rows, respects consent and exclusions, and skips acknowledged deliveries.' })
  .group('Save to the CRM', [deliver, receipt], { description: 'Creates an incoming inquiry and review task; records delivery only after the CRM confirms persistence.' });
