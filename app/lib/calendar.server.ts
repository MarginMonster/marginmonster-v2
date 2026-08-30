// Builds the content calendar: the drops that are genuinely scheduled, plus
// recently generated content.
//
// This used to project the next 8 slots from plan.postIntervalDays at a fixed
// cadence and label them "scheduled". Nothing anywhere read postIntervalDays —
// no worker, no job, no autopilot — so those rows were an invention: dates on
// which nothing was ever going to happen, shown to the merchant as a plan, and
// the page subtitle promised "a new piece roughly every N days" on top of it.
//
// Questlines are the real scheduler. Their slots carry a date, a time, a type
// and a status the poster actually reads and writes, so the calendar now shows
// those and nothing else. An empty calendar is the honest answer when nothing
// is scheduled.

import { db } from "../db.server";
import { parseSchedule } from "./questlines";

export interface CalendarSlot {
  date: string; // ISO date
  label: string; // e.g. "Mon, Jul 8"
  type: string; // BLOG_POST | VIDEO_AD | IMAGE_AD
  status: "scheduled" | "generated";
  title?: string;
}

const TYPE_LABEL: Record<string, string> = {
  BLOG_POST: "Blog post",
  VIDEO_AD: "Product video",
  IMAGE_AD: "Image ad",
  AD_COPY: "Ad copy",
};

/** Questline slot types → the asset vocabulary the calendar UI already speaks. */
const SLOT_TYPE: Record<string, string> = {
  video: "VIDEO_AD",
  image: "IMAGE_AD",
  blog: "BLOG_POST",
  post: "AD_COPY",
};

function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export async function getContentCalendar(shopId: string): Promise<{
  upcoming: CalendarSlot[];
  recent: CalendarSlot[];
  active: boolean;
}> {
  const [plan, quests, assets] = await Promise.all([
    db.plan.findUnique({ where: { shopId }, select: { id: true } }),
    db.questline.findMany({
      where: { shopId, status: "ACTIVE" },
      select: { name: true, scheduleJson: true },
    }),
    db.asset.findMany({
      where: { shopId, type: { in: ["BLOG_POST", "VIDEO_AD", "IMAGE_AD"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  // Every slot a questline still intends to publish. Same date composition the
  // poster uses (slotRunAt in questlines.server.ts) so the calendar and the
  // scheduler can never disagree about when a drop lands.
  const now = Date.now();
  const upcoming: CalendarSlot[] = [];
  for (const q of quests) {
    for (const s of parseSchedule(q.scheduleJson).slots) {
      if (s.status === "POSTED" || s.status === "FAILED") continue;
      const at = new Date(`${s.date}T${s.time || "12:00"}:00`);
      if (isNaN(at.getTime()) || at.getTime() < now) continue;
      upcoming.push({
        date: at.toISOString(),
        label: fmt(at),
        type: SLOT_TYPE[s.type] || s.type,
        status: "scheduled",
        title: s.topic || s.productTitle || q.name,
      });
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  const recent: CalendarSlot[] = assets.map((a) => ({
    date: a.createdAt.toISOString(),
    label: fmt(a.createdAt),
    type: a.type,
    status: "generated",
    title: a.title || undefined,
  }));

  return { upcoming: upcoming.slice(0, 8), recent, active: !!plan };
}

export function typeLabel(t: string): string {
  return TYPE_LABEL[t] || t;
}
