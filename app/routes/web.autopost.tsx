import { json, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { Ico } from "../lib/icons";
import { HeroVideo } from "../components/HeroVideo";
import { useT } from "../lib/ui-lang";
import { readUiLang, tr } from "../lib/ui-i18n";
import { db } from "../db.server";
import { requireWebIdentity } from "../lib/web-auth.server";
import { linkedFromCache, socialProviderEnabled } from "../lib/social-provider.server";
import { isValidTimeZone } from "../lib/timezone";
import { dayBucket, normalizePerDay } from "../lib/post-queue";
import {
  loadComingUp, queueAdd, queuePostNow, queueRemove, queueRetry, setQueuePerDay, skipChannelDrop, type ComingUpRow,
} from "../lib/post-queue.server";
import { networkName } from "../lib/social-networks";

export const meta: MetaFunction = () => [{ title: "Auto-post · EasyMode" }];

/* Auto-post — the way in to everything that posts by itself.
 *
 * The app has four working auto-posting surfaces: linking your socials (web.connect), Channels (a
 * faceless series that posts on a cadence), Product Channels (your catalogue, turned into videos and
 * posted on a cadence) and Campaigns (a month of content made and posted hands-off). When the nav was
 * cut down to one row of studios they lost every way in except a checklist line on the Dashboard and a
 * note in the Archive — the owner, 2026-11-17: "We need to bring back in the autoposting sections".
 *
 * This page changes nothing about how any of them works. It is the door: what each one does, where it
 * stands for this shop, and a way in. */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const linked = socialProviderEnabled() ? linkedFromCache(shop.socialsJson) : [];
  // RUNNING is "ACTIVE". A series the engine paused (out of tokens, a lapsed plan, a social that needs
  // re-linking) is not posting anything, and a green "1 channel running" over it was simply untrue.
  const series = (sourceType: string, status: string) => db.creatorSeries.count({ where: { shopId: shop.id, sourceType, status } });
  const [channels, channelsPaused, productChannels, productChannelsPaused, campaigns, campaignsPaused] = await Promise.all([
    series("vibe", "ACTIVE"), series("vibe", "PAUSED"),
    series("product", "ACTIVE"), series("product", "PAUSED"),
    db.questline.count({ where: { shopId: shop.id, status: "ACTIVE" } }),
    db.questline.count({ where: { shopId: shop.id, status: "PAUSED" } }),
  ]);
  // "Coming up" — the posting queue, the channels' next drops, and what went out in the last day. Times
  // are formatted HERE, in the shop's own zone and the member's language, so the server render and the
  // hydrated page print the same string.
  const lang = readUiLang(request);
  const tz = isValidTimeZone(shop.timezone) ? shop.timezone : "UTC";
  const now = Date.now();
  const timeFmt = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", timeZone: tz });
  const dateFmt = new Intl.DateTimeFormat(lang, { weekday: "short", month: "short", day: "numeric", timeZone: tz });
  const queue = await loadComingUp(shop.id, linked);
  const dress = (r: ComingUpRow) => ({
    ...r,
    time: timeFmt.format(new Date(r.at)),
    bucket: dayBucket(r.at, now, tz),
    dateLabel: dateFmt.format(new Date(r.at)),
    dueNow: r.status === "PENDING" && Date.parse(r.at) <= now,
  });
  return json({
    linked, channels, channelsPaused, productChannels, productChannelsPaused, campaigns, campaignsPaused,
    perDay: normalizePerDay(shop.queuePerDay),
    upcoming: queue.upcoming.map(dress),
    failed: queue.failed.map(dress),
    posted: queue.posted.map(dress),
  });
};

/* The queue's endpoint. The Archive's "Add to queue" posts here too, so the contract is fixed:
 *   queueAdd (assetIds, comma-separated) → { ok, queued, skipped, firstDueAt, lastDueAt } | { error }
 *   queueRemove (id) · queuePostNow (id) · queueRetry (id) · queuePerDay (n) · skipDrop (seriesId)
 *                                        → { ok: true } | { error }
 * Every one is scoped to the signed-in shop inside post-queue.server.ts. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const lang = readUiLang(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const field = (k: string) => String(form.get(k) || "").trim();
  const ERR: Record<string, string> = {
    "provider-off": tr(lang, "Social posting is coming online — check back shortly."),
    "no-accounts": tr(lang, "Link a social account first: open Auto-post and tap “Link your socials”."),
    full: tr(lang, "Your queue is full — 60 pieces are waiting. Remove a few, or let some post first."),
    nothing: tr(lang, "Pick at least one finished video or picture to add to your queue."),
    "not-found": tr(lang, "That piece isn't in your queue any more — refresh to see the latest."),
    posting: tr(lang, "That piece is posting right now, so it can't be stopped."),
    started: tr(lang, "That channel has already started making this video — refresh to see it."),
  };
  const fail = (code: string) => json({ error: ERR[code] || tr(lang, "Something went wrong — try again.") });
  try {
    if (intent === "queueAdd") {
      const r = await queueAdd(shop.id, field("assetIds"));
      if ("error" in r) return fail(r.error);
      return json({ ok: true as const, queued: r.queued, skipped: r.skipped, firstDueAt: r.firstDueAt, lastDueAt: r.lastDueAt });
    }
    let r: { ok: true } | { error: string };
    if (intent === "queueRemove") r = await queueRemove(shop.id, field("id"));
    else if (intent === "queuePostNow") r = await queuePostNow(shop.id, field("id"));
    else if (intent === "queueRetry") r = await queueRetry(shop.id, field("id"));
    else if (intent === "queuePerDay") r = await setQueuePerDay(shop.id, field("n"));
    else if (intent === "skipDrop") r = await skipChannelDrop(shop.id, field("seriesId"));
    else r = { error: "unknown" };
    if ("error" in r) return fail(r.error);
    return json({ ok: true as const });
  } catch (e) {
    console.error(`[autopost] ${intent} failed:`, e);
    return fail("unknown");
  }
};

export default function AutoPost() {
  const d = useLoaderData<typeof loader>();
  const t = useT();
  // what stands under each card: how many are running — or, with none running, how many are paused
  const running = (n: number, paused: number, one: string, many: string) =>
    n > 0 ? t(n === 1 ? one : many, { n }) : paused > 0 ? t(paused === 1 ? "{n} paused" : "{n} paused", { n: paused }) : t("Not set up yet");
  const cards = [
    {
      to: "/web/connect", icon: "link", on: d.linked.length > 0,
      title: t("Link your socials"),
      sub: t("Connect your socials once. After that, anything you make can post itself — with a caption written for it."),
      state: d.linked.length > 0 ? t(d.linked.length === 1 ? "{n} account linked" : "{n} accounts linked", { n: d.linked.length }) : t("Not linked yet"),
      cue: d.linked.length > 0 ? t("Manage accounts") : t("Link an account"),
    },
    {
      to: "/web/channels", icon: "video", on: d.channels > 0, paused: d.channels === 0 && d.channelsPaused > 0,
      title: t("Channels"),
      sub: t("Pick a vibe once. A fresh video is written, voiced, captioned and posted on the schedule you choose — hands off."),
      state: running(d.channels, d.channelsPaused, "{n} channel running", "{n} channels running"),
      cue: d.channels + d.channelsPaused > 0 ? t("Open Channels") : t("Start a channel"),
    },
    {
      to: "/web/product-channels", icon: "box", on: d.productChannels > 0, paused: d.productChannels === 0 && d.productChannelsPaused > 0,
      title: t("Product Channels"),
      sub: t("Point it at your store. It works through your catalogue, turning each product into a video and posting it with a link back."),
      state: running(d.productChannels, d.productChannelsPaused, "{n} product channel running", "{n} product channels running"),
      cue: d.productChannels + d.productChannelsPaused > 0 ? t("Open Product Channels") : t("Start a product channel"),
    },
    {
      to: "/web/campaigns", icon: "megaphone", on: d.campaigns > 0, paused: d.campaigns === 0 && d.campaignsPaused > 0,
      title: t("Campaigns"),
      sub: t("A month of content, made and posted for you: choose what to push, and the calendar fills and runs itself."),
      state: running(d.campaigns, d.campaignsPaused, "{n} campaign running", "{n} campaigns running"),
      cue: d.campaigns + d.campaignsPaused > 0 ? t("Open Campaigns") : t("Plan a campaign"),
    },
  ];
  return (
    <div className="ap-wrap">
      <style dangerouslySetInnerHTML={{ __html: AP_CSS }} />
      <header className="ap-head">
        <span className="ap-head-rose" aria-hidden="true" />
        {/* the same moving band every other section opens with */}
        <span className="ap-head-media" aria-hidden="true"><HeroVideo name="autopost" still={1} clip={1} className="ap-head-img" /></span>
        <div className="ap-head-copy">
          <span className="ap-eyebrow"><Ico n="rocket" size={13} /> {t("Hands off")}</span>
          <h1>{t("Auto-post")}</h1>
          <p>{t("Make it once, or let it make itself — and have it posted for you, on schedule.")}</p>
        </div>
      </header>
      <div className="ap-grid">
        {cards.map((c, i) => (
          <Link key={c.to} to={c.to} className={`ap-card${c.on ? " on" : ""}`}>
            <span className="ap-step" aria-hidden="true">{i + 1}</span>
            <span className="ap-ico" aria-hidden="true"><Ico n={c.icon} size={22} /></span>
            <b>{c.title}</b>
            <span className="ap-sub">{c.sub}</span>
            <span className={`ap-state${c.on ? " on" : "paused" in c && c.paused ? " paused" : ""}`}>{c.on ? <Ico n="check" size={11} /> : null}{c.state}</span>
            <span className="ap-cue">{c.cue} <Ico n="arrow" size={13} /></span>
          </Link>
        ))}
      </div>
      {d.linked.length === 0 && (
        <p className="ap-note"><Ico n="bulb" size={13} /> <span>{t("Start with step 1 — nothing can post until at least one account is linked.")}</span></p>
      )}
      <ComingUp />
    </div>
  );
}

type Row = ReturnType<typeof useLoaderData<typeof loader>>["upcoming"][number];

/** Network names are brand names — never translated. */
const nets = (list: string[]) => list.map(networkName).join(" · ");

/* "Coming up" — the posting queue. One control (posts per day), one list grouped by day, two actions a
 * row. Failed pieces sit on top with the reason in a sentence; what went out in the last day sits quietly
 * at the bottom with its links. */
function ComingUp() {
  const d = useLoaderData<typeof loader>();
  const t = useT();
  const per = useFetcher<typeof action>();
  // Optimistic: the pressed number is the one just tapped, until the page reloads with it.
  const perDay = per.formData ? normalizePerDay(per.formData.get("n")) : d.perDay;
  const pieces = d.upcoming.filter((r) => r.kind === "piece");
  const groups: Array<{ key: string; label: string; rows: Row[] }> = [];
  for (const r of d.upcoming) {
    let g = groups.find((x) => x.key === r.bucket);
    if (!g) {
      g = { key: r.bucket, label: r.bucket === "today" ? t("Today") : r.bucket === "tomorrow" ? t("Tomorrow") : r.dateLabel, rows: [] };
      groups.push(g);
    }
    g.rows.push(r);
  }
  const perErr = per.data && "error" in per.data ? per.data.error : null;
  return (
    <section className="ap-q" aria-labelledby="ap-q-title">
      <div className="ap-q-head">
        <div>
          <h2 id="ap-q-title">{t("Coming up")}</h2>
          <p className="ap-q-lede">{t("Add any piece to your queue and it posts itself at the next good time.")}</p>
        </div>
        <per.Form method="post" className="ap-q-per" role="group" aria-label={t("Posts per day")}>
          <input type="hidden" name="intent" value="queuePerDay" />
          <span className="ap-q-per-l">{t("Posts per day")}</span>
          {[1, 2, 3].map((n) => (
            <button key={n} type="submit" name="n" value={n} className={perDay === n ? "on" : ""} aria-pressed={perDay === n}>{n}</button>
          ))}
        </per.Form>
      </div>
      {perErr && <p className="ap-q-err" role="alert">{perErr}</p>}

      {d.failed.length > 0 && (
        <div className="ap-q-group">
          <h3 className="ap-q-day warn"><Ico n="warning" size={13} /> {t("Didn't post")}</h3>
          {d.failed.map((r) => <QueueRow key={r.id} r={r} />)}
        </div>
      )}

      {groups.map((g) => (
        <div className="ap-q-group" key={g.key}>
          <h3 className="ap-q-day">{g.label}</h3>
          {g.rows.map((r) => <QueueRow key={`${r.kind}-${r.id}`} r={r} />)}
        </div>
      ))}

      {pieces.length === 0 && d.failed.length === 0 && (
        <div className="ap-q-empty">
          <span className="ap-ico" aria-hidden="true"><Ico n="hourglass" size={22} /></span>
          <p>{t("Nothing in your queue yet. Open a piece in the Archive and tap “Add to queue” — it posts itself at the next good time.")}</p>
          <Link to="/web/archive" className="ap-q-btn primary">{t("Open the Archive")} <Ico n="arrow" size={13} /></Link>
        </div>
      )}

      {d.posted.length > 0 && (
        <div className="ap-q-group quiet">
          <h3 className="ap-q-day">{t("Posted in the last day")}</h3>
          {d.posted.map((r) => <QueueRow key={r.id} r={r} />)}
        </div>
      )}
    </section>
  );
}

function QueueRow({ r }: { r: Row }) {
  const t = useT();
  const f = useFetcher<typeof action>();
  const busy = f.state !== "idle";
  const err = f.data && "error" in f.data ? f.data.error : null;
  const missed = r.error?.startsWith("missed:") ? r.error.slice(7).split(",").filter(Boolean) : [];

  // Every state, said in a sentence.
  let line: string;
  if (r.kind === "drop") {
    line = r.autoPost && r.networks.length
      ? t("Your channel makes a new video and posts it to {nets}.", { nets: nets(r.networks) })
      : t("Your channel makes a new video. It waits for you to post it.");
  } else if (r.status === "FAILED") {
    line = failReason(r.error, t);
  } else if (r.status === "POSTED") {
    line = missed.length
      ? t("Posted to {landed}. It didn't reach {missed}.", { landed: nets(r.networks), missed: nets(missed) })
      : t("Posted to {nets}.", { nets: nets(r.networks) });
  } else if (r.status === "POSTING") {
    line = t("Posting now to {nets}…", { nets: nets(r.networks) });
  } else if (r.dueNow) {
    line = t("Going out within a minute to {nets}.", { nets: nets(r.networks) });
  } else {
    line = r.networks.length ? t("Posts to {nets}.", { nets: nets(r.networks) }) : t("Link an account and it posts there.");
  }

  const button = (intent: string, label: string, opts: { primary?: boolean; field?: string } = {}) => (
    <f.Form method="post" className="ap-q-act">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name={opts.field || "id"} value={r.id} />
      <button type="submit" className={`ap-q-btn${opts.primary ? " primary" : ""}`} disabled={busy}>{label}</button>
    </f.Form>
  );

  return (
    <div className={`ap-q-row${r.status === "FAILED" ? " failed" : ""}${r.status === "POSTED" ? " posted" : ""}`}>
      <span className="ap-q-time">{r.status === "POSTING" || r.dueNow ? t("Now") : r.time}</span>
      <span className="ap-q-thumb" aria-hidden="true">
        {r.thumb ? <img src={r.thumb} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
          : <Ico n={r.kind === "drop" ? "video" : "image"} size={20} />}
      </span>
      <span className="ap-q-body">
        <b>{r.kind === "drop" ? t("{name} — new video", { name: r.title }) : r.title}</b>
        <span className="ap-q-line">{line}</span>
        {r.status === "POSTED" && Object.keys(r.urls).length > 0 && (
          <span className="ap-q-links">
            {Object.entries(r.urls).map(([p, u]) => (
              <a key={p} href={u} target="_blank" rel="noreferrer">{t("View post")} · {networkName(p)}</a>
            ))}
          </span>
        )}
        {err && <span className="ap-q-err" role="alert">{err}</span>}
      </span>
      <span className="ap-q-acts">
        {r.kind === "drop" && button("skipDrop", t("Skip"), { field: "seriesId" })}
        {r.kind === "piece" && r.status === "PENDING" && !r.dueNow && button("queuePostNow", t("Post now"), { primary: true })}
        {r.kind === "piece" && r.status === "FAILED" && button("queueRetry", t("Try again"), { primary: true })}
        {r.kind === "piece" && (r.status === "PENDING" || r.status === "FAILED") && button("queueRemove", t("Remove"))}
      </span>
    </div>
  );
}

/** Why a queued piece didn't post — in a plain sentence, with what to do next. */
function failReason(code: string | null, t: (s: string, p?: Record<string, string | number>) => string): string {
  const c = code || "";
  if (c === "interrupted") return t("We lost track of this one while it was posting, so it may already be live. Check your accounts before you try again.");
  if (c === "duplicate") return t("This piece went out a moment ago, so it wasn't sent twice.");
  if (c === "no-accounts") return t("There was no linked account to post to. Link one under “Link your socials”, then try again.");
  if (c === "no-media") return t("This piece has no video or picture to post.");
  if (c === "gone") return t("This piece is no longer in your Archive.");
  if (c === "provider-off") return t("Posting is switched off for the moment. Try again shortly.");
  if (c === "no-profile") return t("We couldn't reach the posting service. Try again in a minute.");
  if (c.startsWith("failed:")) return t("Your accounts turned it down ({err}). Check your linked accounts, then try again.", { err: c.slice(7) });
  return t("Something went wrong before it was sent, so nothing was posted. Try again.");
}

const AP_CSS = `
.ap-wrap{max-width:1360px;margin:0 auto;}
.ap-head{position:relative;isolation:isolate;overflow:hidden;display:flex;align-items:center;min-height:150px;margin-bottom:20px;border-radius:22px;background:radial-gradient(120% 160% at 0% 0%,#3A8660 0%,#226043 42%,#143F2B 100%);box-shadow:0 24px 54px -28px rgba(8,62,39,.62),inset 0 0 0 1px rgba(255,255,255,.08);}
.ap-head-rose{position:absolute;z-index:0;left:-130px;bottom:-190px;width:380px;height:380px;background:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.3;mix-blend-mode:screen;pointer-events:none;animation:apspin 115s linear infinite;}
.ap-head-media{position:absolute;z-index:0;right:0;top:0;bottom:0;width:56%;-webkit-mask-image:linear-gradient(90deg,transparent,#000 46%);mask-image:linear-gradient(90deg,transparent,#000 46%);}
.ap-head-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 56%;display:block;}
@keyframes apspin{to{transform:rotate(360deg);}}
.ap-head-copy{position:relative;z-index:1;max-width:58%;padding:26px clamp(22px,3.4vw,48px);}
.ap-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:800;color:#E7C879;text-transform:uppercase;letter-spacing:.09em;}
.ap-head h1{margin:8px 0 0;font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(28px,3.2vw,44px);line-height:1.05;letter-spacing:-.025em;color:#fff;}
.ap-head p{margin:10px 0 0;max-width:520px;font-size:15px;line-height:1.5;color:rgba(255,255,255,.86);}
.ap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;}
.ap-card{position:relative;display:flex;flex-direction:column;gap:8px;padding:20px 20px 18px;border-radius:18px;border:1px solid var(--line,#E1DECD);background:#fff;color:var(--ink,#14201A);text-decoration:none;box-shadow:0 1px 2px rgba(20,32,26,.04),0 10px 24px -16px rgba(20,32,26,.24);transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s,border-color .2s;}
.ap-card:hover{transform:translateY(-4px);border-color:#9CCBB1;box-shadow:0 2px 4px rgba(20,32,26,.05),0 24px 40px -20px rgba(20,32,26,.4);}
.ap-card.on{border-color:#BFE0CD;}
.ap-step{position:absolute;top:16px;right:18px;font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:#B9C4B5;font-variant-numeric:tabular-nums;}
.ap-ico{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:#E3F3EA;color:var(--green,#0C7A46);}
.ap-card b{margin-top:4px;font-family:Poppins,sans-serif;font-weight:800;font-size:18px;line-height:1.2;letter-spacing:-.01em;}
.ap-sub{flex:1 1 auto;font-size:13.5px;line-height:1.5;color:var(--ink2,#4A554E);}
.ap-state{align-self:flex-start;display:inline-flex;align-items:center;gap:5px;margin-top:4px;padding:4px 10px;border-radius:999px;background:#F1EFE4;color:var(--ink2,#4A554E);font-size:11.5px;font-weight:800;}
.ap-state.on{background:#E3F3EA;color:var(--green,#0C7A46);}
.ap-state.paused{background:#FDF4E3;color:#8A5A12;}
.ap-cue{display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:13.5px;font-weight:800;color:var(--green,#0C7A46);}
.ap-note{display:flex;align-items:flex-start;gap:7px;margin:16px 2px 0;font-size:13px;line-height:1.45;color:var(--ink2,#4A554E);}
.ap-note svg{flex:0 0 auto;margin-top:2px;}
.ap-q{margin-top:28px;padding:20px;border-radius:18px;border:1px solid var(--line,#E1DECD);background:#fff;color:var(--ink,#14201A);box-shadow:0 1px 2px rgba(20,32,26,.04),0 10px 24px -16px rgba(20,32,26,.24);}
.ap-q-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px 20px;margin-bottom:6px;}
.ap-q-head h2{margin:0;font-family:Poppins,sans-serif;font-weight:800;font-size:22px;line-height:1.2;letter-spacing:-.015em;}
.ap-q-lede{margin:4px 0 0;font-size:13.5px;line-height:1.45;color:var(--ink2,#4A554E);}
.ap-q-per{display:inline-flex;align-items:center;gap:6px;margin:0;}
.ap-q-per-l{margin-right:4px;font-size:13px;font-weight:800;color:var(--ink2,#4A554E);}
.ap-q-per button{min-width:44px;min-height:44px;border-radius:12px;border:1px solid var(--line,#E1DECD);background:#FBFAF4;color:var(--ink,#14201A);font:800 15px Poppins,sans-serif;cursor:pointer;}
.ap-q-per button.on{background:var(--green,#0C7A46);border-color:var(--green,#0C7A46);color:#fff;}
.ap-q-group{margin-top:16px;}
.ap-q-day{display:flex;align-items:center;gap:6px;margin:0 0 6px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--ink2,#4A554E);}
.ap-q-day.warn{color:#8A5A12;}
.ap-q-row{display:grid;grid-template-columns:64px 52px minmax(0,1fr) auto;align-items:center;gap:10px 12px;padding:10px 0;border-top:1px solid #EFECE0;}
.ap-q-row.failed{margin:0 -10px;padding:10px;border-radius:12px;border-top:0;background:#FDF4E3;}
.ap-q-row.failed+.ap-q-row.failed{margin-top:6px;}
.ap-q-row.posted{opacity:.78;}
.ap-q-time{font-family:Poppins,sans-serif;font-weight:800;font-size:14px;font-variant-numeric:tabular-nums;color:var(--green,#0C7A46);}
.ap-q-thumb{width:52px;height:52px;border-radius:10px;overflow:hidden;display:grid;place-items:center;background:#E3F3EA;color:var(--green,#0C7A46);}
.ap-q-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
.ap-q-body{display:flex;flex-direction:column;gap:2px;min-width:0;}
.ap-q-body b{font-size:14.5px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ap-q-line{font-size:13px;line-height:1.4;color:var(--ink2,#4A554E);}
.ap-q-links{display:flex;flex-wrap:wrap;gap:4px 12px;}
.ap-q-links a{display:inline-flex;align-items:center;min-height:32px;font-size:13px;font-weight:800;color:var(--green,#0C7A46);}
.ap-q-err{display:block;margin:6px 0 0;font-size:13px;line-height:1.4;font-weight:700;color:#A3361C;}
.ap-q-acts{display:flex;gap:8px;justify-content:flex-end;}
.ap-q-act{margin:0;}
.ap-q-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line,#E1DECD);background:#fff;color:var(--ink,#14201A);font-size:13.5px;font-weight:800;text-decoration:none;cursor:pointer;white-space:nowrap;}
.ap-q-btn.primary{background:var(--green,#0C7A46);border-color:var(--green,#0C7A46);color:#fff;}
.ap-q-btn:disabled{opacity:.55;cursor:default;}
.ap-q-empty{display:flex;flex-direction:column;align-items:flex-start;gap:10px;margin-top:16px;padding:18px;border-radius:14px;background:#FBFAF4;border:1px dashed #D9D5C2;}
.ap-q-empty p{margin:0;font-size:14px;line-height:1.5;color:var(--ink,#14201A);}
@media(max-width:640px){.ap-q{padding:16px;margin-top:20px;}.ap-q-row{grid-template-columns:52px minmax(0,1fr);}.ap-q-time{grid-column:1 / -1;font-size:13px;}.ap-q-acts{grid-column:1 / -1;justify-content:stretch;}.ap-q-act{flex:1 1 0;}.ap-q-btn{width:100%;}.ap-q-per{width:100%;}.ap-q-per-l{flex:1 1 auto;}}
@media(max-width:640px){.ap-head{min-height:0;border-radius:18px;margin-bottom:16px;}.ap-head-copy{max-width:66%;padding:20px 18px;}.ap-head-media{width:50%;}.ap-head p{font-size:13.5px;}.ap-grid{gap:12px;}.ap-card{padding:16px 16px 15px;}}
@media(prefers-reduced-motion:reduce){.ap-head-rose{animation:none;}.ap-card{transition:none;}.ap-card:hover{transform:none;}}
`;
