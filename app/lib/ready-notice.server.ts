/* What the "your film is ready" notice reads (ready-notice.ts decides; routes/web.tsx shows it).
 * Two small indexed reads of the signed-in shop's own rows; nothing is written. */
import { db } from "../db.server";
import type { ReadyState } from "./ready-notice";

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
      select: { id: true, title: true, createdAt: true },
    });
    return { cooking, newest: v ? { id: v.id, title: v.title || "", at: v.createdAt.toISOString() } : null };
  } catch {
    return { cooking, newest: null };
  }
}
