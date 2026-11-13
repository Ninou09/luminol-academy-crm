import { DatabaseSync } from "node:sqlite";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withDatabase, initializeDatabase, adminPassword } from "./db.mjs";

/**
 * Execute each request against its own SQLite connection. Responses stay buffered
 * until a conditional durable save succeeds. A failed CAS returns 409 rather
 * than claiming that an update saved. No /tmp file is treated as durable storage.
 */
export function createHostedHandler(app, store) {
  return async function hostedHandler(req, res) {
    const directory = await mkdtemp(join(tmpdir(), "luminol-"));
    const path = join(directory, "request.sqlite");
    let connection;
    const originalEnd = res.end.bind(res);
    const originalWrite = res.write.bind(res);
    const originalWriteHead = res.writeHead.bind(res);
    const originalFlush = res.flushHeaders.bind(res);
    const chunks = [];
    let ended = false;
    try {
      if (adminPassword().length < 16) {
        throw new Error(
          "Set a strong ADMIN_PASSWORD (or DEMO_PASSWORD) before starting the hosted workspace.",
        );
      }
      const snapshot = await store.read();
      if (snapshot) await writeFile(path, snapshot.bytes);
      connection = new DatabaseSync(path);
      connection.exec(
        "PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000;",
      );
      const changesBefore = connection
        .prepare("SELECT total_changes() AS n")
        .get().n;
      await withDatabase(connection, async () => {
        initializeDatabase();
        await new Promise((resolve, reject) => {
          res.write = (chunk, encoding, callback) => {
            if (chunk)
              chunks.push(
                Buffer.isBuffer(chunk)
                  ? chunk
                  : Buffer.from(
                      chunk,
                      typeof encoding === "string" ? encoding : undefined,
                    ),
              );
            if (typeof encoding === "function") encoding();
            callback?.();
            return true;
          };
          res.end = (chunk, encoding, callback) => {
            if (chunk)
              chunks.push(
                Buffer.isBuffer(chunk)
                  ? chunk
                  : Buffer.from(
                      chunk,
                      typeof encoding === "string" ? encoding : undefined,
                    ),
              );
            if (typeof encoding === "function") encoding();
            callback?.();
            ended = true;
            resolve();
            return res;
          };
          // Prevent an Express adapter from flushing cookies or status early.
          res.writeHead = (status, message, headers) => {
            res.statusCode = status;
            const values = typeof message === "object" ? message : headers;
            for (const [name, value] of Object.entries(values || {}))
              res.setHeader(name, value);
            return res;
          };
          res.flushHeaders = () => {};
          req.once("aborted", () => reject(new Error("Client disconnected.")));
          app(req, res, (error) =>
            error ? reject(error) : reject(new Error("Unmatched API route.")),
          );
        });
      });
      // The first successful request of each day also triggers a backup copy.
      const day = new Date().toISOString().slice(0, 10);
      let backupDue = false;
      if (store.backup && res.statusCode < 400) {
        const last = connection
          .prepare("SELECT value FROM meta WHERE key='last_backup'")
          .get()?.value;
        if (last !== day) {
          connection
            .prepare(
              "INSERT INTO meta(key,value) VALUES ('last_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            )
            .run(day);
          backupDue = true;
        }
      }
      const changed =
        connection.prepare("SELECT total_changes() AS n").get().n !==
        changesBefore;
      connection.close();
      connection = null;
      if (changed && res.statusCode < 500) {
        const bytes = await readFile(path);
        if (bytes.length > 64 * 1024 * 1024)
          throw new Error(
            "Workspace exceeded the snapshot size limit. Move it to managed SQL storage.",
          );
        await store.write(bytes, snapshot?.etag);
        if (backupDue)
          await store
            .backup(bytes, day)
            .catch((error) =>
              console.error("Daily backup failed:", error?.message),
            );
      }
      res.write = originalWrite;
      res.writeHead = originalWriteHead;
      res.flushHeaders = originalFlush;
      res.end = originalEnd;
      const body = Buffer.concat(chunks);
      res.setHeader("Content-Length", body.length);
      originalEnd(body);
    } catch (error) {
      connection?.close();
      res.write = originalWrite;
      res.writeHead = originalWriteHead;
      res.flushHeaders = originalFlush;
      res.end = originalEnd;
      for (const name of res.getHeaderNames()) res.removeHeader(name);
      const conflict = /Precondition|AlreadyExists|already exists/i.test(
        error?.name + " " + error?.message,
      );
      res.statusCode = conflict ? 409 : 503;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      if (!conflict)
        console.error(
          "Hosted storage request failed:",
          error?.name,
          error?.message,
        );
      originalEnd(
        JSON.stringify({
          error: conflict
            ? "Another request saved first. Refresh and retry; this change was not saved."
            : "Cloud storage is temporarily unavailable. No changes were acknowledged. Try again shortly.",
        }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
