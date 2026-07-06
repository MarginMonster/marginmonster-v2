// Builds the content calendar: upcoming auto-publish slots projected from the
// plan's cadence, plus recently generated content.

import { db } from "../db.server";

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

function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export async function getContentCalendar(shopId: string): Promise<{
  cadenceDays: number;
  upcoming: CalendarSlot[];
  recent: CalendarSlot[];
  active: boolean;
}> {
  const plan = await db.plan.findUnique({ where: { shopId } });
  const cadence = plan?.postIntervalDays || 3;

  // What content types this plan produces.
  const types: string[] = [];
  if ((plan?.blogQuota ?? 0) > 0) types.push("BLOG_POST");
  if ((plan?.videoQuota ?? 0) > 0) types.push("VIDEO_AD");
  if ((plan?.imageQuota ?? 0) > 0) types.push("IMAGE_AD");
  if (types.length === 0) types.push("BLOG_POST");

  // Project the next ~8 slots from today at the plan cadence, rotating types.
  const upcoming: CalendarSlot[] = [];
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + cadence * (i + 1));
    upcoming.push({
      date: d.toISOString(),
      label: fmt(d),
      type: types[i % types.length],
      status: "scheduled",
    });
  }

  // Recently generated content.
  const assets = await db.asset.findMany({
    where: { shopId, type: { in: ["BLOG_POST", "VIDEO_AD", "IMAGE_AD"] } },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  const recent: CalendarSlot[] = assets.map((a) => ({
    date: a.createdAt.toISOString(),
    label: fmt(a.createdAt),
    type: a.type,
    status: "generated",
    title: a.title || undefined,
  }));

  return { cadenceDays: cadence, upcoming, recent, active: !!plan };
}

export function typeLabel(t: string): string {
  return TYPE_LABEL[t] || t;
}
