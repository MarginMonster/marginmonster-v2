import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "../db.server";

/* Serves a shop's custom-forged companion frames from the DB (Render disk is
 * ephemeral). Shop ids are unguessable cuids; frames are a|b|c. Buffered
 * response — never raw streams (see renders.$file for the crash history). */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  try {
    const { shopId, frame } = params;
    if (!shopId || !/^[a-z0-9]+$/i.test(shopId) || !["a", "b", "c"].includes(frame || "")) {
      return new Response("Not found", { status: 404 });
    }
    const shop = await db.shop.findUnique({
      where: { id: shopId },
      select: { companionArt: true, companionArtB: true, companionArtC: true },
    });
    const b64 = frame === "b" ? shop?.companionArtB : frame === "c" ? shop?.companionArtC : shop?.companionArt;
    // blink/cheer fall back to the base frame so the flipbook never breaks
    const data = b64 || shop?.companionArt;
    if (!data) return new Response("Not found", { status: 404 });
    return new Response(Buffer.from(data, "base64"), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    console.error("[companion-art] serve failed:", e);
    return new Response("Error", { status: 500 });
  }
};
