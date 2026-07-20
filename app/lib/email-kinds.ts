/* Client-safe email kind definitions — shared by the Email Studio UI and the
 * server-only writer. (Kept out of *.server.ts so the route component can import
 * it without pulling server code into the client bundle.) */

export type EmailKind =
  | "broadcast"
  | "abandoned_cart"
  | "welcome"
  | "winback"
  | "post_purchase";

export const EMAIL_KINDS: { key: EmailKind; label: string; blurb: string; icon: string }[] = [
  { key: "broadcast", label: "Broadcast", blurb: "A one-off promo to your whole list", icon: "📣" },
  { key: "abandoned_cart", label: "Abandoned Cart", blurb: "Win back a shopper who left items behind", icon: "🛒" },
  { key: "welcome", label: "Welcome", blurb: "Greet a brand-new subscriber", icon: "👋" },
  { key: "winback", label: "Win-Back", blurb: "Re-engage a customer who's gone quiet", icon: "💌" },
  { key: "post_purchase", label: "Post-Purchase", blurb: "Thank a buyer and tease what's next", icon: "🎁" },
];
