# Film Studio — Pre-Launch Scaling Checklist

The Film engine (the entertainment video engine: music videos, kids cartoons,
moral/horror/short-film stories) **works**, but it's currently a single-user
build. Before opening it to real volume it needs scaling hardening. This captures
what breaks at scale and the work to fix it. **Status: NOT needed while building
/ single-user testing — this is a pre-launch-at-volume milestone.**

## Why it won't scale as-is

Each film render fires MANY concurrent AI-provider calls (an i2v clip per scene +
seed images + music/singing), and every render in the whole app shares ONE
fal/Replicate account. That's fine for one user; it falls over with many.

1. **Provider rate limits — the hard wall.** 200 users × ~4 concurrent clips ≈
   ~800 simultaneous requests against a provider that caps concurrency (and the
   account is already rate-limited). It throttles/rejects → everyone's renders
   crawl or fail. Not a code problem — an account-capacity problem.
2. **Worker saturation.** A film is a 30–40 min job. A flood of them hogs the
   worker and starves the quick jobs other users need (image ads, short clips).
3. **Cost.** Free × many users × dozens of clips each = unbounded COGS.

## The hardening work (before launch at volume)

- [ ] **Global rate-limiter on provider calls** — a shared semaphore / token
      bucket so TOTAL concurrent provider requests never exceed the account
      ceiling. Renders queue fairly within that budget; one user's 24-scene epic
      can't starve everyone else. (Per-render `CLIP_CONCURRENCY` must bow to this
      global cap.)
- [ ] **Real provider capacity** — a paid fal/Replicate tier with higher
      concurrency, and/or multiple API keys with round-robin. The single account
      is the bottleneck.
- [ ] **Films in their own queue lane** — separate from quick jobs so a film
      backlog never blocks image ads / short clips.
- [ ] **Per-user caps** — max concurrent renders per user; queue-depth limits;
      reject/queue gracefully past them.
- [ ] **Queue-position + background UX** — "you're #N in line, ~X min"; submit →
      notify when done (don't make users watch a 40-min spinner). Finished films
      already land in the Archive; add the notify.
- [ ] **Dollar pricing live** — covers COGS AND throttles demand. Free is a
      build-phase setting only (`FILM_BASE`/`FILM_PER_SCENE` = 0 right now).
- [ ] **Load / stress test** before opening the doors.

## Notes

- EasyMode already has a job queue (`db.job` + the worker) to build the above on.
- Realistic truth about speed: AI video is ~3–5 min **per clip**; a long video is
  many clips, so long content is inherently slow to render even parallelized.
  The answer isn't "make it instant" — it's background-by-design + fair queueing
  + enough provider capacity.
- Related: [[project_film_engine]], [[project_economics]], the "serial-worker
  OOM-risk" already flagged in [[project_easymode_hardening]].

_Captured 2026-11-01._
