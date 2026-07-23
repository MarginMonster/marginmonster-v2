import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { getContentCalendar } from "../lib/calendar.server";

const TYPE: Record<string, { label: string; icon: string }> = {
  BLOG_POST: { label: "Blog", icon: "✍️" },
  VIDEO_AD: { label: "Video", icon: "🎬" },
  IMAGE_AD: { label: "Image", icon: "🖼️" },
  AD_COPY: { label: "Ad copy", icon: "📣" },
};
const meta = (t: string) => TYPE[t] || { label: t, icon: "•" };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return json({ cal: null });
  const cal = await getContentCalendar(shop.id);
  return json({ cal });
};

export default function Content() {
  const { cal } = useLoaderData<typeof loader>();
  const [view, setView] = useState<"timeline" | "calendar">("timeline");

  if (!cal || !cal.active) {
    return (
      <Page title="Content" backAction={{ content: "Home", url: "/app" }}>
        <EmptyState heading="No plan yet" image="" action={{ content: "Choose a plan", url: "/app/plans" }}>
          <p>Pick a plan and we'll schedule your content automatically — this is where you'll see everything going out.</p>
        </EmptyState>
      </Page>
    );
  }

  // Timeline: group the upcoming slots by day.
  const groups: { label: string; items: typeof cal.upcoming }[] = [];
  for (const s of cal.upcoming) {
    let g = groups.find((x) => x.label === s.label);
    if (!g) { g = { label: s.label, items: [] }; groups.push(g); }
    g.items.push(s);
  }

  // Calendar: a month grid for the current month, dots per day by content type.
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const monthName = today.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const byDay: Record<number, string[]> = {};
  [...cal.upcoming, ...cal.recent].forEach((s) => {
    const d = new Date(s.date);
    if (d.getFullYear() === y && d.getMonth() === m) {
      (byDay[d.getDate()] ||= []).push(s.type);
    }
  });
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <Page
      title="Content"
      backAction={{ content: "Home", url: "/app" }}
      subtitle={`On autopilot — a new piece roughly every ${cal.cadenceDays} days.`}
    >
      <div className="em-sched">
        <div className="em-seg">
          <button type="button" className={view === "timeline" ? "on" : ""} onClick={() => setView("timeline")}>🗓️ Timeline</button>
          <button type="button" className={view === "calendar" ? "on" : ""} onClick={() => setView("calendar")}>📅 Calendar</button>
        </div>

        <div className="em-legend">
          <span><i className="t-VIDEO_AD" />Video</span>
          <span><i className="t-IMAGE_AD" />Image</span>
          <span><i className="t-BLOG_POST" />Blog</span>
        </div>

        {view === "timeline" ? (
          <div className="em-tl">
            {groups.map((g, gi) => (
              <div className="em-day" key={gi}>
                <div className="em-daylbl">{gi === 0 ? "Next up" : g.label}{gi === 0 ? <small>&nbsp;· {g.label}</small> : null}</div>
                {g.items.map((s, i) => {
                  const mt = meta(s.type);
                  return (
                    <div className="em-ev" key={i}>
                      <span className={`em-ic t-${s.type}`}>{mt.icon}</span>
                      <span className="em-m"><b>{s.title || `${mt.label} — from your catalog`}</b><span>{mt.label} · to your socials</span></span>
                      <span className="em-chip sched">Scheduled</span>
                    </div>
                  );
                })}
              </div>
            ))}
            {cal.recent.length > 0 && (
              <div className="em-day">
                <div className="em-daylbl">Recently made</div>
                {cal.recent.slice(0, 4).map((s, i) => {
                  const mt = meta(s.type);
                  return (
                    <div className="em-ev" key={i}>
                      <span className={`em-ic t-${s.type}`}>{mt.icon}</span>
                      <span className="em-m"><b>{s.title || mt.label}</b><span>{mt.label} · {s.label}</span></span>
                      <span className="em-chip made">Made</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="em-cal">
            <div className="em-calhd"><b>{monthName}</b></div>
            <div className="em-dow"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
            <div className="em-grid">
              {cells.map((d, i) => (
                <div key={i} className={`em-cell${d === null ? " empty" : ""}${d === today.getDate() ? " today" : ""}`}>
                  {d !== null && (
                    <>
                      <span className="n">{d}</span>
                      <span className="em-dots">
                        {(byDay[d] || []).slice(0, 3).map((t, j) => <i key={j} className={`t-${t}`} />)}
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
