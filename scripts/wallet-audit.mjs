/* READ-ONLY wallet audit. Reports Plan rows in a state the code should never
 * have produced, and the repair for each. Writes nothing — run it, read it,
 * then decide.
 *
 *   DATABASE_URL="postgres://…" node scripts/wallet-audit.mjs
 *
 * Two states matter, and they fail in opposite directions:
 *
 *   tokensExtra < 0  — legacy, from the double-spend that existed before the
 *     wallet got its compare-and-swap. The merchant is not locked out, which is
 *     why nobody noticed: the negative is quietly re-subtracted from their
 *     FRESH allowance every month, forever, with nothing in the UI to explain
 *     where the tokens went. Our bug, so the repair is to forgive it (set to 0).
 *
 *   tokensUsed < 0   — from the concurrent-refund hole (two refunds clamping
 *     against the same stale read). This MINTS tokens: the allowance is
 *     included - used, so a negative inflates it, and it raises the trial
 *     ceiling too. The repair is to reclaim it (set to 0).
 *
 * Both holes are closed in app/lib/tokens.server.ts, and the read paths now
 * clamp so an existing bad row can no longer mint or tax. This script is for
 * cleaning up rows that already exist.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const sel = { shopId: true, type: true, tokensIncluded: true, tokensUsed: true, tokensExtra: true };

try {
  const total = await db.plan.count();
  const negExtra = await db.plan.findMany({ where: { tokensExtra: { lt: 0 } }, select: sel, orderBy: { tokensExtra: "asc" } });
  const negUsed = await db.plan.findMany({ where: { tokensUsed: { lt: 0 } }, select: sel, orderBy: { tokensUsed: "asc" } });

  console.log(`plans: ${total}\n`);

  console.log(`tokensExtra < 0  (silently taxes the merchant every month): ${negExtra.length}`);
  for (const p of negExtra) console.log("   ", JSON.stringify(p));
  if (negExtra.length) {
    console.log("\n   repair:  await db.plan.updateMany({ where: { tokensExtra: { lt: 0 } }, data: { tokensExtra: 0 } })\n");
  }

  console.log(`tokensUsed  < 0  (inflates the wallet and the trial ceiling): ${negUsed.length}`);
  for (const p of negUsed) console.log("   ", JSON.stringify(p));
  if (negUsed.length) {
    console.log("\n   repair:  await db.plan.updateMany({ where: { tokensUsed: { lt: 0 } }, data: { tokensUsed: 0 } })\n");
  }

  if (!negExtra.length && !negUsed.length) console.log("\nNothing to repair.");
} finally {
  await db.$disconnect();
}
