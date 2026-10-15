import { get, put } from "@vercel/blob";

/** The database blob is private; its URL is never exposed to the browser. */
export function createBlobSnapshotStore() {
  const environment =
    process.env.VERCEL_ENV === "production"
      ? "production"
      : `preview-${(process.env.VERCEL_GIT_COMMIT_REF || "default").replace(/[^a-zA-Z0-9-]/g, "-")}`;
  const pathname = `luminol-crm/${environment}/workspace.sqlite`;
  return {
    async read() {
      const result = await get(pathname, {
        access: "private",
        useCache: false,
      });
      if (!result) return null;
      if (result.statusCode !== 200 || !result.stream)
        throw new Error("Database snapshot was not readable.");
      return {
        bytes: Buffer.from(await new Response(result.stream).arrayBuffer()),
        etag: result.blob.etag,
      };
    },
    async write(bytes, etag) {
      // The first create must not overwrite a concurrent first initialization.
      // Later saves compare ETags, preventing lost updates across function instances.
      return put(pathname, bytes, {
        access: "private",
        contentType: "application/vnd.sqlite3",
        addRandomSuffix: false,
        allowOverwrite: Boolean(etag),
        cacheControlMaxAge: 60,
        ...(etag ? { ifMatch: etag } : {}),
      });
    },
  };
}
