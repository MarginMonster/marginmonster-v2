/* Starred presenters sit first wherever one is picked, and the cast filters narrow by what is known. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { favouritesFirst, ageBand, passes, NO_FILTER } from "../app/lib/favourites.ts";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("favourites go first, each group keeps its order", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(favouritesFirst(list, ["c", "a"]).map((x) => x.id), ["a", "c", "b", "d"]);
  assert.equal(favouritesFirst(list, []), list, "no stars: the same list back");
  assert.deepEqual(favouritesFirst(list, ["zz"]).map((x) => x.id), ["a", "b", "c", "d"], "a star on someone gone changes nothing");
});

test("a stated age falls into its band; no stated age is no band", () => {
  assert.equal(ageBand("Mid 20s"), "20");
  assert.equal(ageBand("Early 30s"), "30");
  assert.equal(ageBand("Late 40s"), "40");
  assert.equal(ageBand("Early 60s"), "40");
  assert.equal(ageBand(""), "");
});

test("filters pass only what matches; unset passes all", () => {
  const mei = { gender: "f", age: "Mid 20s", energy: "warm" };
  assert.ok(passes(mei, NO_FILTER));
  assert.ok(passes(mei, { sex: "f", age: "20", energy: "warm" }));
  assert.ok(!passes(mei, { ...NO_FILTER, sex: "m" }));
  assert.ok(!passes(mei, { ...NO_FILTER, age: "30" }));
  assert.ok(!passes({ gender: "m", age: "", energy: "calm" }, { ...NO_FILTER, age: "20" }), "no stated age is not guessed into a band");
});

test("every picker puts the shop's favourites first", () => {
  for (const f of ["app/routes/web.presenters.tsx", "app/routes/web.studio.tsx", "app/routes/web.film.tsx"]) {
    const src = read(f);
    assert.ok(src.includes("favouritesFirst("), `${f} sorts by the shop's stars`);
    assert.ok(src.includes("favouritesFor("), `${f} reads the shop's stars`);
  }
  const film = read("app/routes/web.film.tsx");
  assert.ok(film.indexOf("favouritesFirst(") < film.indexOf(".slice(0, 70)"), "the roster is starred before it is cut to 70");
});
