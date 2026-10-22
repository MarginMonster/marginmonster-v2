import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "../db.server";

/* TEMPORARY owner admin helper — delete after deactivating the beta account.
 * Key-guarded. ?list = show beta-ish accounts (email, plan active, activity);
 * ?deact=<email> = set that account's plan.active=false (reversible — it does
 * NOT delete anything, the account + gallery stay). */
const KEY = "ba-5h8k2m9x4q";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== KEY) return new Response("not found", { status: 404 });

  if (url.searchParams.get("list")) {
    const accounts = await db.account.findMany({
      where: { OR: [{ name: "Beta Tester" }, { email: { contains: "beta" } }, { email: { contains: "test" } }] },
      select: { id: true, email: true, name: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const out = [];
    for (const a of accounts) {
      const conn = await db.connection.findFirst({ where: { accountId: a.id, kind: "web" } });
      const shopId = conn?.externalId;
      const plan = shopId ? await db.plan.findUnique({ where: { shopId }, select: { active: true, type: true, tokensIncluded: true, tokensUsed: true, tokensExtra: true } }) : null;
      const assets = shopId ? await db.asset.count({ where: { shopId } }) : 0;
      const spendable = plan ? plan.tokensIncluded - plan.tokensUsed + plan.tokensExtra : null;
      out.push({ email: a.email, name: a.name, created: a.createdAt, shopId, planActive: plan?.active ?? null, planType: plan?.type ?? null, tokensSpendable: spendable, tokensExtra: plan?.tokensExtra ?? null, assets });
    }
    return Response.json(out);
  }

  const deact = url.searchParams.get("deact");
  if (deact) {
    const account = await db.account.findUnique({ where: { email: deact.toLowerCase().trim() } });
    if (!account) return Response.json({ error: "no account with that email" }, { status: 404 });
    const conn = await db.connection.findFirst({ where: { accountId: account.id, kind: "web" } });
    const shopId = conn?.externalId;
    if (!shopId) return Response.json({ error: "account has no web shop" }, { status: 500 });
    const before = await db.plan.findUnique({ where: { shopId }, select: { active: true, type: true, tokensIncluded: true, tokensUsed: true, tokensExtra: true } });
    if (!before) return Response.json({ error: "account has no plan" }, { status: 404 });
    // Deactivate + ZERO all spendable tokens ("no more spending"): drop the
    // included allowance and the purchased/beta extra to 0 so nothing is left
    // to spend. Reversible (account + gallery untouched); re-seed to restore.
    await db.plan.update({ where: { shopId }, data: { active: false, cancelAtPeriodEnd: true, tokensIncluded: 0, tokensExtra: 0, tokensUsed: 0 } });
    return Response.json({
      deactivated: account.email,
      shopId,
      wasActive: before.active,
      planType: before.type,
      tokensRemoved: { included: before.tokensIncluded, extra: before.tokensExtra, spendableWas: before.tokensIncluded - before.tokensUsed + before.tokensExtra },
      nowActive: false,
      tokensNow: 0,
    });
  }

  return Response.json({ error: "pass ?list or ?deact=<email> (with key)" }, { status: 400 });
}
