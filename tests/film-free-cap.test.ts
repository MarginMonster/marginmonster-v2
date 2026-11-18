/* Films are free while the section is finished (plan-config FILM_BASE / FILM_PER_SCENE = 0), so one
 * account could render hundreds of dollars of acted films a day. FILM_FREE_DAILY_CAP is the owner's switch:
 * unset = no cap (today's behaviour), n = n films per account per 24 hours; admins are never capped. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the free-film cap is a switch: off unless FILM_FREE_DAILY_CAP is set, never for admins, only while films are free", () => {
  const film = read("app/routes/web.film.tsx");
  const at = film.indexOf('if (intent === "film") {');
  assert.ok(at > 0);
  const head = film.slice(at, at + 1600);
  assert.ok(head.includes('parseInt(process.env.FILM_FREE_DAILY_CAP || "", 10)'), "read from the environment");
  assert.ok(head.includes("Number.isFinite(freeCap) && freeCap > 0"), "unset or 0 = no cap");
  assert.ok(head.includes("estimateFilmTokens(1) === 0"), "only while films are free");
  assert.ok(head.includes("!isAdminEmail(account.email)"), "admins are never capped");
  assert.ok(head.includes('payload: { contains: \'"contentType":"film"\' }'), "counts films, not other videos");
  assert.ok(head.indexOf("freeCap") < head.indexOf("spendTokens") || !head.includes("spendTokens"), "checked before anything is spent");
});
