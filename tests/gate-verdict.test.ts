import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGateVerdict, outageReason } from "../app/lib/gate-verdict.ts";

/* The gates decide whether an ad the merchant paid for is allowed to ship.
 * Every case below shipped a "pass" before this module existed. */

test("an explicit true is the only thing that passes", () => {
  assert.equal(parseGateVerdict('{"pass":true,"reason":"clean"}').ok, true);
  assert.equal(parseGateVerdict('{"pass":true,"reason":"clean"}').degraded, false);
});

test("an explicit false is a real rejection, not a degraded one", () => {
  const v = parseGateVerdict('{"pass":false,"reason":"warped label"}');
  assert.equal(v.ok, false);
  // false, so the caller SHOULD spend a retry — the judge actually looked
  assert.equal(v.degraded, false);
  assert.equal(v.reason, "warped label");
});

test("a verdict with no pass key does not pass", () => {
  // `j.pass !== false` returned TRUE here, and the ad shipped unchecked
  const v = parseGateVerdict('{"reason":"looks fine to me"}');
  assert.equal(v.ok, false);
  assert.equal(v.degraded, true);
});

test("the STRING \"false\" does not pass", () => {
  // `"false" !== false` is true, so this shipped too
  const v = parseGateVerdict('{"pass":"false","reason":"warped"}');
  assert.equal(v.ok, false);
  assert.equal(v.degraded, true);
});

test("the string \"true\" is not a verdict either", () => {
  assert.equal(parseGateVerdict('{"pass":"true"}').ok, false);
  assert.equal(parseGateVerdict('{"pass":"true"}').degraded, true);
});

test("0 and 1 are not verdicts", () => {
  assert.equal(parseGateVerdict('{"pass":1}').ok, false);
  assert.equal(parseGateVerdict('{"pass":1}').degraded, true);
  assert.equal(parseGateVerdict('{"pass":0}').ok, false);
});

test("null is not a verdict", () => {
  assert.equal(parseGateVerdict('{"pass":null}').ok, false);
  assert.equal(parseGateVerdict('{"pass":null}').degraded, true);
});

test("prose around the JSON is fine — judges do that", () => {
  const v = parseGateVerdict('Sure! Here is my verdict:\n{"pass": true, "reason": "clean"}\nHope that helps.');
  assert.equal(v.ok, true);
  assert.equal(v.degraded, false);
});

test("unreadable, empty and missing replies are degraded, never a pass", () => {
  for (const raw of ["", "   ", "no json here at all", "{not json}", null, undefined]) {
    const v = parseGateVerdict(raw as string);
    assert.equal(v.ok, false, `raw=${JSON.stringify(raw)} must not pass`);
    assert.equal(v.degraded, true, `raw=${JSON.stringify(raw)} must be degraded`);
  }
});

test("a verdict wrapped in an array is still read", () => {
  // The {...} match is deliberately lenient because judges wrap their JSON in
  // prose; an array is just another wrapper, and the intent is unambiguous.
  // Documented here so the leniency is a decision rather than an accident.
  const v = parseGateVerdict('[{"pass":true,"reason":"clean"}]');
  assert.equal(v.ok, true);
  assert.equal(v.degraded, false);
});

test("JSON that is not an object at all is degraded", () => {
  for (const raw of ["123", '"true"', "true", "null"]) {
    const v = parseGateVerdict(raw);
    assert.equal(v.ok, false, `raw=${raw} must not pass`);
    assert.equal(v.degraded, true, `raw=${raw} must be degraded`);
  }
});

test("the verdict and reason keys are configurable — the commercial gate uses ok/why", () => {
  const v = parseGateVerdict('{"ok":false,"why":"melted hand"}', "ok", "why", 120);
  assert.equal(v.ok, false);
  assert.equal(v.degraded, false);
  assert.equal(v.reason, "melted hand");
  // and the wrong key still means "no verdict"
  assert.equal(parseGateVerdict('{"pass":true}', "ok", "why").degraded, true);
});

test("a long reason is bounded so it cannot bloat a log line or a column", () => {
  const v = parseGateVerdict(JSON.stringify({ pass: false, reason: "x".repeat(900) }));
  assert.equal(v.reason.length, 200);
  assert.equal(parseGateVerdict(JSON.stringify({ ok: false, why: "y".repeat(900) }), "ok", "why", 120).reason.length, 120);
});

test("a non-string reason is dropped rather than stringified into noise", () => {
  assert.equal(parseGateVerdict('{"pass":false,"reason":{"a":1}}').reason, "");
});

test("outageReason keeps the message and stays short", () => {
  assert.match(outageReason(new Error("socket hang up")), /^qa-outage: socket hang up$/);
  assert.ok(outageReason(new Error("z".repeat(500))).length <= "qa-outage: ".length + 100);
});
