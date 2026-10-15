import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { createServer } from "node:http";

// This test file runs in its own node:test process, without a real cloud token.
process.env.VERCEL = "1";
process.env.DEMO_PASSWORD = "HostedTestPassword!2026";
const { createHostedHandler } = await import("../server/hosted-handler.mjs");
const { one, run } = await import("../server/db.mjs");

function memoryStore() {
  let value = null,
    version = 0;
  return {
    async read() {
      return value
        ? { bytes: Buffer.from(value), etag: String(version) }
        : null;
    },
    async write(bytes, etag) {
      if ((value && etag !== String(version)) || (!value && etag)) {
        const e = new Error("The ETag does not match");
        e.name = "BlobPreconditionFailedError";
        throw e;
      }
      value = Buffer.from(bytes);
      version++;
      return { etag: String(version) };
    },
  };
}

test("cloud snapshots survive separate request connections and never acknowledge lost writes", async () => {
  const store = memoryStore();
  const app = express();
  app.use(express.json());
  app.get("/value", (req, res) =>
    res.json(one("SELECT academy FROM settings WHERE id=1")),
  );
  app.post("/value", (req, res) => {
    run("UPDATE settings SET academy=? WHERE id=1", req.body.name);
    res.json({ ok: true });
  });
  const handler = createHostedHandler(app, store),
    server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(
      (await (await fetch(base + "/value")).json()).academy,
      "Luminol Academy",
    );
    const save = await fetch(base + "/value", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Persistent academy" }),
    });
    assert.equal(save.status, 200);
    assert.equal(
      (await (await fetch(base + "/value")).json()).academy,
      "Persistent academy",
    );
    const original = store.write;
    store.write = async () => {
      const e = new Error("ETag mismatch");
      e.name = "BlobPreconditionFailedError";
      throw e;
    };
    const conflict = await fetch(base + "/value", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Must not persist" }),
    });
    assert.equal(conflict.status, 409);
    assert.match((await conflict.json()).error, /not saved/);
    store.write = original;
    assert.equal(
      (await (await fetch(base + "/value")).json()).academy,
      "Persistent academy",
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("parallel function instances cannot overwrite each other and failed cookies are discarded", async () => {
  const store = memoryStore();
  const app = express();
  app.use(express.json());
  app.get("/value", (req, res) =>
    res.json(one("SELECT academy FROM settings WHERE id=1")),
  );
  let waiting = [];
  app.post("/race", (req, res) => {
    run("UPDATE settings SET academy=? WHERE id=1", req.body.name);
    res.cookie("should_only_save_on_success", req.body.name);
    waiting.push(() => res.json({ saved: req.body.name }));
    if (waiting.length === 2) {
      const callbacks = waiting;
      waiting = [];
      callbacks.forEach((fn) => fn());
    }
  });
  const a = createServer(createHostedHandler(app, store)),
    b = createServer(createHostedHandler(app, store));
  a.listen(0, "127.0.0.1");
  b.listen(0, "127.0.0.1");
  await Promise.all([once(a, "listening"), once(b, "listening")]);
  const first = `http://127.0.0.1:${a.address().port}`,
    second = `http://127.0.0.1:${b.address().port}`;
  try {
    await fetch(first + "/value");
    const results = await Promise.all(
      [
        [first, "A"],
        [second, "B"],
      ].map(([url, name]) =>
        fetch(url + "/race", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }),
      ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const loser = results.find((r) => r.status === 409);
    assert.equal(loser.headers.get("set-cookie"), null);
    const winner = await results.find((r) => r.status === 200).json();
    assert.equal(
      (await (await fetch(first + "/value")).json()).academy,
      winner.saved,
    );
  } finally {
    a.close();
    b.close();
    await Promise.all([once(a, "close"), once(b, "close")]);
  }
});

test("storage outage returns 503 and never a false save confirmation", async () => {
  const app = express();
  app.get("/state", (req, res) => res.json({ ok: true }));
  const store = {
    read: async () => {
      throw new Error("Simulated storage outage");
    },
  };
  const server = createServer(createHostedHandler(app, store));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/state`,
    );
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /No changes were acknowledged/);
  } finally {
    server.close();
    await once(server, "close");
  }
});
