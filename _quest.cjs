const fs = require('fs');
const f = 'app/lib/questlines.server.ts';
let s = fs.readFileSync(f, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
const J = (a) => a.join(nl);

const edits = [
  // --- accept(): remember which bucket paid ---
  [J([
    '  try {',
    '    await spendTokens(params.shopId, cost); // the whole month, reserved upfront',
    '  } catch (e) {',
    '    return { ok: false, error: e instanceof Error ? e.message : "Not enough tokens." };',
    '  }',
   ]),
   J([
    '  let acceptFromExtra = 0;',
    '  try {',
    '    // fromExtra is kept because a refund has to go back into the bucket it',
    '    // came out of. Without it, purchased tokens return as monthly allowance',
    '    // and expire at the next period roll — the merchant paid cash for those.',
    '    acceptFromExtra = (await spendTokens(params.shopId, cost)).fromExtra; // the whole month, reserved upfront',
    '  } catch (e) {',
    '    return { ok: false, error: e instanceof Error ? e.message : "Not enough tokens." };',
    '  }',
   ])],

  ['      tokenCost: cost,\n      xpReward: def.xpReward,',
   '      tokenCost: cost,\n      tokenFromExtra: acceptFromExtra,\n      xpReward: def.xpReward,'],

  // --- addDropToQuestline(): the charge must join the refundable total ---
  [J([
    '  const cost = type === "video" ? TOKEN_COST.video : type === "image" ? TOKEN_COST.image : TOKEN_COST.blog;',
    '  try {',
    '    await spendTokens(shopId, cost);',
    '  } catch (e) {',
    '    return { ok: false, error: e instanceof Error ? e.message : "Not enough tokens." };',
    '  }',
    '',
    '  const schedule = parseSchedule(q.scheduleJson);',
   ]),
   J([
    '  const cost = type === "video" ? TOKEN_COST.video : type === "image" ? TOKEN_COST.image : TOKEN_COST.blog;',
    '  let addedFromExtra = 0;',
    '  try {',
    '    addedFromExtra = (await spendTokens(shopId, cost)).fromExtra;',
    '  } catch (e) {',
    '    return { ok: false, error: e instanceof Error ? e.message : "Not enough tokens." };',
    '  }',
    '  // A drop added after accept is charged separately and starts SCHEDULED, so',
    '  // it is refundable — but tokenCost only ever held the ACCEPT price, and',
    '  // abandon caps the refund at tokenCost. Every later drop was therefore paid',
    '  // for and silently kept on abandon. tokenCost is now the running total of',
    '  // everything charged for content that has not been generated yet.',
    '  await db.questline.update({',
    '    where: { id: q.id },',
    '    data: { tokenCost: { increment: cost }, tokenFromExtra: { increment: addedFromExtra } },',
    '  });',
    '',
    '  const schedule = parseSchedule(q.scheduleJson);',
   ])],

  // --- one-off drop: same, for the MANUAL questline ---
  [J([
    '  const cost = type === "video" ? TOKEN_COST.video : type === "image" ? TOKEN_COST.image : TOKEN_COST.blog;',
    '  try {',
    '    await spendTokens(shopId, cost);',
    '  } catch (e) {',
    '    return { ok: false, error: e instanceof Error ? e.message : "Not enough tokens." };',
    '  }',
    '',
    '  let q = await db.questline.findFirst({ where: { shopId, template: "MANUAL", status: "ACTIVE" } });',
   ]),
   J([
    '  const cost = type === "video" ? TOKEN_COST.video : type === "image" ? TOKEN_COST.image : TOKEN_COST.blog;',
    '  let oneOffFromExtra = 0;',
    '  try {',
    '    oneOffFromExtra = (await spendTokens(shopId, cost)).fromExtra;',
    '  } catch (e) {',
    '    return { ok: false, error: e instanceof Error ? e.message : "Not enough tokens." };',
    '  }',
    '',
    '  let q = await db.questline.findFirst({ where: { shopId, template: "MANUAL", status: "ACTIVE" } });',
   ])],

  ['        durationDays: 3650, tokenCost: 0, xpReward: 0, progress: 0,',
   '        durationDays: 3650, tokenCost: cost, tokenFromExtra: oneOffFromExtra, xpReward: 0, progress: 0,'],

  // --- abandon: refund into the bucket it came from ---
  ['    try { await refundTokens(shopId, refund); } catch (e) { console.error("[questline] refund failed:", e); refund = 0; }',
   J([
    '    try {',
    '      // Back into the bucket it came out of. Passing no fromExtra credited',
    '      // the whole refund to the monthly allowance, so tokens the merchant had',
    '      // BOUGHT came back as allowance and expired at the next period roll.',
    '      await refundTokens(shopId, refund, Math.min(refund, q.tokenFromExtra));',
    '    } catch (e) { console.error("[questline] refund failed:", e); refund = 0; }',
   ])],
];

for (const [a] of edits) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error('anchor count ' + n + ': ' + a.slice(0, 80)); process.exit(1); }
}
for (const [a, b] of edits) s = s.split(a).join(b);
fs.writeFileSync(f, s);
console.log('questline charges tracked per bucket and per total');
