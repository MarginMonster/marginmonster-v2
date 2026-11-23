/* COLLECTIONS (2026-11-22) — named shelves in the Archive ("Summer launch") that a piece can sit on.
 *
 * Every query here is scoped by the shop: a collection is found by its id AND the shop's id, and a piece
 * is linked only once it has been read back as one of the shop's own assets. The route's action reads the
 * form and says what happened; the database work is all here.
 *
 * A collection item cascades away with its collection or its asset (prisma/schema.prisma), so deleting a
 * collection never touches a piece, and deleting a piece takes it off every shelf. */

import { db } from "../db.server";

/* ── COLLECTIONS · THE PURE PART ──────────────────────────────────────────────────────────────────────
 * The name rules and the id list, with nothing imported, so tests/archive-collections.test.ts can lift
 * this block out and run it exactly as written. Plain values in, plain values out. */

/** A name is 1–40 characters once trimmed. */
const COL_NAME_MAX = 40;
/** At most this many collections per shop. */
const COL_MAX = 50;
/** What can be wrong, in words the route turns into a sentence. */
type ColProblem = "empty" | "long" | "taken" | "full" | "gone" | "none";

/** A name as it is kept: trimmed, and any run of spaces (a tab, a newline pasted in) made one space. */
function cleanColName(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/** What is wrong with a (cleaned) name on its own — a clash with another collection is the database's to say. */
function colNameProblem(name: string): "empty" | "long" | null {
  if (!name) return "empty";
  if (Array.from(name).length > COL_NAME_MAX) return "long";
  return null;
}

/** "Summer launch" and "summer LAUNCH" are one name to a person, so they clash. */
function sameColName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The form's comma-separated asset ids: well-formed ones only, each once, never more than a page. */
function parseAssetIds(v: unknown): string[] {
  const ids = String(v ?? "").split(",").map((x) => x.trim()).filter((x) => /^[a-z0-9]{10,40}$/i.test(x));
  return [...new Set(ids)].slice(0, 300);
}
/* ── end of the pure part ─────────────────────────────────────────────────────────────────────────── */

export { COL_MAX, COL_NAME_MAX, cleanColName, colNameProblem, parseAssetIds, sameColName };
export type { ColProblem };

export type ColSummary = { id: string; name: string; count: number };
/** Every answer has the same shape: the collection it was about, and how many pieces moved (added or removed). */
export type ColResult = { ok: true; collection: { id: string; name: string }; n: number } | { ok: false; problem: ColProblem; name?: string };

/** The shop's collections, A to Z, each with how many pieces it holds. */
export async function listCollections(shopId: string): Promise<ColSummary[]> {
  const rows = await db.collection.findMany({
    where: { shopId },
    select: { id: true, name: true, _count: { select: { items: true } } },
  });
  return rows
    .map((r) => ({ id: r.id, name: r.name, count: r._count.items }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Which of the shop's collections each of these pieces is on: assetId → collection ids. */
export async function collectionIdsByAsset(shopId: string, assetIds: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (!assetIds.length) return out;
  const rows = await db.collectionItem.findMany({
    where: { assetId: { in: assetIds }, collection: { shopId } },
    select: { assetId: true, collectionId: true },
  });
  for (const r of rows) (out[r.assetId] ||= []).push(r.collectionId);
  return out;
}

const isUniqueClash = (e: unknown) => !!e && typeof e === "object" && (e as { code?: unknown }).code === "P2002";

/** Is another of this shop's collections already called that (any case)? */
async function nameTaken(shopId: string, name: string, exceptId?: string): Promise<boolean> {
  const hits = await db.collection.findMany({
    where: { shopId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { name: true },
    take: 5,
  });
  return hits.some((h) => sameColName(h.name, name));
}

/** A new, empty collection. */
export async function createCollection(shopId: string, rawName: unknown): Promise<ColResult> {
  const name = cleanColName(rawName);
  const bad = colNameProblem(name);
  if (bad) return { ok: false, problem: bad };
  if ((await db.collection.count({ where: { shopId } })) >= COL_MAX) return { ok: false, problem: "full" };
  if (await nameTaken(shopId, name)) return { ok: false, problem: "taken", name };
  try {
    const collection = await db.collection.create({ data: { shopId, name }, select: { id: true, name: true } });
    return { ok: true, collection, n: 0 };
  } catch (e) {
    // two taps racing on one name: the unique index says no to the second
    if (isUniqueClash(e)) return { ok: false, problem: "taken", name };
    throw e;
  }
}

/** Put pieces on a collection — an existing one (`collectionId`) or one made in the same step (`newName`).
 *  Only the shop's own pieces are linked; a piece already there is left alone, and `n` is how many were
 *  actually added. Nothing is made when none of the pieces is the shop's. */
export async function addToCollection(shopId: string, target: { collectionId?: string; newName?: unknown }, rawIds: unknown): Promise<ColResult> {
  const ids = parseAssetIds(rawIds);
  if (!ids.length) return { ok: false, problem: "none" };
  const owned = await db.asset.findMany({ where: { id: { in: ids }, shopId }, select: { id: true } });
  if (!owned.length) return { ok: false, problem: "none" };
  let collection: { id: string; name: string } | null;
  if (target.collectionId) {
    collection = await db.collection.findFirst({ where: { id: target.collectionId, shopId }, select: { id: true, name: true } });
    if (!collection) return { ok: false, problem: "gone" };
  } else {
    const made = await createCollection(shopId, target.newName);
    if (!made.ok) return made;
    collection = made.collection;
  }
  const r = await db.collectionItem.createMany({
    data: owned.map((a) => ({ collectionId: collection!.id, assetId: a.id })),
    skipDuplicates: true,
  });
  return { ok: true, collection, n: r.count };
}

/** Take pieces off one of the shop's collections. The pieces themselves stay. */
export async function removeFromCollection(shopId: string, collectionId: string, rawIds: unknown): Promise<ColResult> {
  const ids = parseAssetIds(rawIds);
  if (!ids.length) return { ok: false, problem: "none" };
  const collection = await db.collection.findFirst({ where: { id: collectionId, shopId }, select: { id: true, name: true } });
  if (!collection) return { ok: false, problem: "gone" };
  const r = await db.collectionItem.deleteMany({ where: { collectionId: collection.id, collection: { shopId }, assetId: { in: ids } } });
  return { ok: true, collection, n: r.count };
}

/** A new name for one of the shop's collections (the same rules as a new one; its own old name is no clash). */
export async function renameCollection(shopId: string, collectionId: string, rawName: unknown): Promise<ColResult> {
  const name = cleanColName(rawName);
  const bad = colNameProblem(name);
  if (bad) return { ok: false, problem: bad };
  const found = await db.collection.findFirst({ where: { id: collectionId, shopId }, select: { id: true } });
  if (!found) return { ok: false, problem: "gone" };
  if (await nameTaken(shopId, name, found.id)) return { ok: false, problem: "taken", name };
  try {
    const r = await db.collection.updateMany({ where: { id: found.id, shopId }, data: { name } });
    if (r.count !== 1) return { ok: false, problem: "gone" };
  } catch (e) {
    if (isUniqueClash(e)) return { ok: false, problem: "taken", name };
    throw e;
  }
  return { ok: true, collection: { id: found.id, name }, n: 0 };
}

/** Delete one of the shop's collections. Its links go with it (cascade); every piece stays in the Archive. */
export async function deleteCollection(shopId: string, collectionId: string): Promise<ColResult> {
  const found = await db.collection.findFirst({ where: { id: collectionId, shopId }, select: { id: true, name: true } });
  if (!found) return { ok: false, problem: "gone" };
  const r = await db.collection.deleteMany({ where: { id: found.id, shopId } });
  if (r.count !== 1) return { ok: false, problem: "gone" };
  return { ok: true, collection: found, n: 0 };
}
