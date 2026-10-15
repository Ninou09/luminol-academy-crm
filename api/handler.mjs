import app from "../server/index.mjs";
import { createHostedHandler } from "../server/hosted-handler.mjs";
import { createBlobSnapshotStore } from "../server/cloud-store.mjs";

const handler = createHostedHandler(app, createBlobSnapshotStore());
export default function api(req, res) {
  const route =
    req.query?.route ||
    new URL(req.url, "https://localhost").searchParams.get("route");
  if (typeof route === "string") req.url = `/api/${route}`;
  return handler(req, res);
}
