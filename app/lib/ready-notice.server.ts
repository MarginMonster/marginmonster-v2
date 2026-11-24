/* What the "your film is ready" notice reads (ready-notice.ts decides; routes/web.tsx shows it).
 * Two small indexed reads of the signed-in shop's own rows; nothing is written. */
import { db } from "../db.server";
import type { ReadyState } from "./ready-notice";
import { posterOf } from "./story-poster";
import { storyStars } from "./story-picture";

/** The job types that make a piece a member waits for. */
const MAKING = ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_SONG", "GENERATE_BLOG_POST"] as const;

/** How many of this shop's pieces are rendering right now — the Archive's own count of "cooking" tiles:
 *  a job being worked on, or one waiting whose time has come (a drop scheduled for later is not cooking). */
export async function cookingCount(shopId: string): Promise<number> {
  try {
    const jobs = await db.job.findMany({
      where: { shopId, status: { in: ["PENDING", "IN_PROGRESS"] }, type: { in: [...MAKING] } },
      select: { status: true, runAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const now = Date.now();
    return jobs.filter((j) => j.status === "IN_PROGRESS" || !j.runAt || j.runAt.getTime() <= now).length;
  } catch {
    return 0; // a notice is a nicety: a failed count must never break a page
  }
}

/** One look: what is rendering, and the newest finished video. */
export async function readyState(shopId: string): Promise<ReadyState> {
  const cooking = await cookingCount(shopId);
  try {
    const v = await db.asset.findFirst({
      where: { shopId, type: "VIDEO_AD", status: { not: "FAILED" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true, metaJson: true },
    });
    if (!v) return { cooking, newest: null };
    // (a film that made its own poster is announced as a premiere: its poster, and who is in it)
    const poster = posterOf(v.metaJson);
    const cast = poster ? storyStars(v.metaJson).map((s) => s.name).slice(0, 3) : [];
    return { cooking, newest: { id: v.id, title: v.title || "", at: v.createdAt.toISOString(), ...(poster ? { poster, cast } : {}) } };
  } catch {
    return { cooking, newest: null };
  }
}
