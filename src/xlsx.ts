// Minimal .xlsx reader: unzip with the platform's DecompressionStream and read
// the sheet XML directly. It accepts files written by Excel, Google Sheets and
// generators that use prefixed XML (<x:c>) or inline/formula strings, which the
// read-excel-file package rejects.
export type Cell = string | number | boolean | null;
export type SheetRows = Record<string, Cell>[];

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buffer: ArrayBuffer): Promise<Map<string, string>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("This file is not a valid .xlsx file.");
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extraLength + commentLength;
    if (!/\.(xml|rels)$/.test(name)) continue;
    const start =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    const data = method === 8 ? await inflate(raw) : raw;
    files.set(name.replace(/^\//, ""), decoder.decode(data));
  }
  return files;
}

const entity = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === "#")
      return String.fromCodePoint(
        k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10),
      );
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[k] ?? "";
  });
const texts = (xml: string) =>
  entity(
    Array.from(
      xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g),
      (m) => m[1],
    ).join(""),
  );
const attr = (tag: string, name: string) =>
  tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] ?? "";
const column = (ref: string) =>
  [...ref.replace(/\d+$/, "")].reduce(
    (n, ch) => n * 26 + ch.charCodeAt(0) - 64,
    0,
  ) - 1;

export async function readWorkbook(
  buffer: ArrayBuffer,
): Promise<Record<string, SheetRows>> {
  const grids = await readGrids(buffer);
  const result: Record<string, SheetRows> = {};
  for (const [name, grid] of Object.entries(grids)) {
    const head = (grid[0] || []).map((h) => String(h ?? "").trim());
    result[name] = grid
      .slice(1)
      .filter((r) => r.some((v) => v !== null && v !== undefined && v !== ""))
      .map((r) =>
        Object.fromEntries(
          head
            .map((h, i) => [h, r[i] === undefined || r[i] === "" ? null : r[i]])
            .filter(([h]) => h),
        ),
      );
  }
  return result;
}

// Every sheet as a grid of cells, in workbook order.
export async function readGrids(
  buffer: ArrayBuffer,
): Promise<Record<string, Cell[][]>> {
  const files = await unzip(buffer);
  const shared = Array.from(
    (files.get("xl/sharedStrings.xml") || "").matchAll(
      /<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g,
    ),
    (m) => texts(m[1]),
  );
  const rels = new Map<string, string>();
  for (const m of (files.get("xl/_rels/workbook.xml.rels") || "").matchAll(
    /<(?:\w+:)?Relationship\b([^>]*)\/?>/g,
  ))
    rels.set(attr(m[1], "Id"), attr(m[1], "Target"));
  const result: Record<string, Cell[][]> = {};
  for (const m of (files.get("xl/workbook.xml") || "").matchAll(
    /<(?:\w+:)?sheet\b([^>]*)\/?>/g,
  )) {
    const name = entity(attr(m[1], "name"));
    const target = rels.get(attr(m[1], "r:id")) || "";
    const path = target.startsWith("/")
      ? target.slice(1)
      : "xl/" + target.replace(/^\.\//, "");
    const xml = files.get(path);
    if (!xml) continue;
    const grid: Cell[][] = [];
    for (const row of xml.matchAll(
      /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g,
    )) {
      const cells: Cell[] = [];
      for (const c of row[1].matchAll(
        /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g,
      )) {
        const ref = attr(c[1], "r");
        const type = attr(c[1], "t");
        const inner = c[2] || "";
        const v = inner.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
        let value: Cell = null;
        if (type === "inlineStr") value = texts(inner);
        else if (v === undefined) value = null;
        else if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "b") value = v === "1";
        else if (type === "str" || type === "d" || type === "e")
          value = entity(v);
        else value = Number.isFinite(Number(v)) ? Number(v) : entity(v);
        cells[ref ? column(ref) : cells.length] = value;
      }
      grid.push(cells);
    }
    result[name] = grid;
  }
  return result;
}
