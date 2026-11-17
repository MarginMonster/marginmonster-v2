import { json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Ico } from "../lib/icons";
import { useT } from "../lib/ui-lang";
import { db } from "../db.server";
import { requireWebIdentity } from "../lib/web-auth.server";
import { linkedFromCache, socialProviderEnabled } from "../lib/social-provider.server";

export const meta: MetaFunction = () => [{ title: "Auto-post · EASYMODE" }];

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
  const [channels, productChannels, campaigns] = await Promise.all([
    db.creatorSeries.count({ where: { shopId: shop.id, sourceType: "vibe", status: { not: "ENDED" } } }),
    db.creatorSeries.count({ where: { shopId: shop.id, sourceType: "product", status: { not: "ENDED" } } }),
    db.questline.count({ where: { shopId: shop.id, status: "ACTIVE" } }),
  ]);
  return json({ linked, channels, productChannels, campaigns });
};

export default function AutoPost() {
  const d = useLoaderData<typeof loader>();
  const t = useT();
  const running = (n: number, one: string, many: string) => (n > 0 ? t(n === 1 ? one : many, { n }) : t("Not set up yet"));
  const cards = [
    {
      to: "/web/connect", icon: "link", on: d.linked.length > 0,
      title: t("Link your socials"),
      sub: t("Connect TikTok, Instagram and Facebook once. After that, anything you make can post itself — with a caption written for it."),
      state: d.linked.length > 0 ? t(d.linked.length === 1 ? "{n} account linked" : "{n} accounts linked", { n: d.linked.length }) : t("Not linked yet"),
      cue: d.linked.length > 0 ? t("Manage accounts") : t("Link an account"),
    },
    {
      to: "/web/channels", icon: "video", on: d.channels > 0,
      title: t("Channels"),
      sub: t("Pick a vibe once. A fresh video is written, voiced, captioned and posted on the schedule you choose — hands off."),
      state: running(d.channels, "{n} channel running", "{n} channels running"),
      cue: d.channels > 0 ? t("Open Channels") : t("Start a channel"),
    },
    {
      to: "/web/product-channels", icon: "box", on: d.productChannels > 0,
      title: t("Product Channels"),
      sub: t("Point it at your store. It works through your catalogue, turning each product into a video and posting it with a link back."),
      state: running(d.productChannels, "{n} product channel running", "{n} product channels running"),
      cue: d.productChannels > 0 ? t("Open Product Channels") : t("Start a product channel"),
    },
    {
      to: "/web/campaigns", icon: "megaphone", on: d.campaigns > 0,
      title: t("Campaigns"),
      sub: t("A month of content, made and posted for you: choose what to push, and the calendar fills and runs itself."),
      state: running(d.campaigns, "{n} campaign running", "{n} campaigns running"),
      cue: d.campaigns > 0 ? t("Open Campaigns") : t("Plan a campaign"),
    },
  ];
  return (
    <div className="ap-wrap">
      <style dangerouslySetInnerHTML={{ __html: AP_CSS }} />
      <header className="ap-head">
        <span className="ap-head-rose" aria-hidden="true" />
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
            <span className={`ap-state${c.on ? " on" : ""}`}>{c.on ? <Ico n="check" size={11} /> : null}{c.state}</span>
            <span className="ap-cue">{c.cue} <Ico n="arrow" size={13} /></span>
          </Link>
        ))}
      </div>
      {d.linked.length === 0 && (
        <p className="ap-note"><Ico n="bulb" size={13} /> <span>{t("Start with step 1 — nothing can post until at least one account is linked.")}</span></p>
      )}
    </div>
  );
}

const AP_CSS = `
.ap-wrap{max-width:1360px;margin:0 auto;}
.ap-head{position:relative;isolation:isolate;overflow:hidden;display:flex;align-items:center;min-height:150px;margin-bottom:20px;border-radius:22px;background:radial-gradient(120% 160% at 0% 0%,#3A8660 0%,#226043 42%,#143F2B 100%);box-shadow:0 24px 54px -28px rgba(8,62,39,.62),inset 0 0 0 1px rgba(255,255,255,.08);}
.ap-head-rose{position:absolute;z-index:0;right:-110px;top:50%;width:380px;height:380px;margin-top:-190px;background:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.3;mix-blend-mode:screen;pointer-events:none;animation:apspin 115s linear infinite;}
@keyframes apspin{to{transform:rotate(360deg);}}
.ap-head-copy{position:relative;z-index:1;padding:26px clamp(22px,3.4vw,48px);}
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
.ap-cue{display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:13.5px;font-weight:800;color:var(--green,#0C7A46);}
.ap-note{display:flex;align-items:flex-start;gap:7px;margin:16px 2px 0;font-size:13px;line-height:1.45;color:var(--ink2,#4A554E);}
.ap-note svg{flex:0 0 auto;margin-top:2px;}
@media(max-width:640px){.ap-head{min-height:0;border-radius:18px;margin-bottom:16px;}.ap-head-copy{padding:20px 18px;}.ap-head p{font-size:13.5px;}.ap-grid{gap:12px;}.ap-card{padding:16px 16px 15px;}}
@media(prefers-reduced-motion:reduce){.ap-head-rose{animation:none;}.ap-card{transition:none;}.ap-card:hover{transform:none;}}
`;
