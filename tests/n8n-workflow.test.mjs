import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("n8n normalization excludes opted-out, historic and converted rows and emits only intake fields", () => {
  const source = readFileSync(
    new URL("../integrations/n8n-new-inquiries.ts", import.meta.url),
    "utf8",
  );
  const code = source.match(/jsCode: `([\s\S]*?)`/)[1];
  const baseline = {
    id: 1,
    full_name: "Workflow Sample",
    email: "sample@example.test",
    phone: "",
    consent: true,
    createdAt: "2026-10-15T13:10:01.000Z",
    metadata_json: "{}",
  };
  const input = [
    baseline,
    { ...baseline, id: 2, consent: false },
    { ...baseline, id: 3, status: "do_not_contact" },
    { ...baseline, id: 4, converted_at: "2026-10-15T13:10:01.000Z" },
    { ...baseline, id: 5, createdAt: "2026-10-14T13:10:00.000Z" },
    { ...baseline, id: 6, metadata_json: JSON.stringify({ is_test: true }) },
    { ...baseline, id: 7, metadata_json: JSON.stringify({ opted_out: true }) },
    {
      ...baseline,
      id: 8,
      notes: "private clinical notes",
      metadata_json: JSON.stringify({
        language: "ar",
        confidential: "private metadata",
      }),
    },
    { ...baseline, id: 9, metadata_json: JSON.stringify({ do_not_contact: "true" }) },
  ].map((json) => ({ json }));
  const result = JSON.parse(
    JSON.stringify(
      runInNewContext(
        "(function(){" + code + "})()",
        { $input: { all: () => input } },
        { timeout: 1000 },
      ),
    ),
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].json.external_id, "n8n-leads:1");
  assert.equal(result[1].json.language, "العربية");
  assert.equal(result[1].pairedItem.item, 7);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(result[0].json.metadata_json, undefined);
  assert.equal(result[0].json.notes, undefined);
});
