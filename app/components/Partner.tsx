/* AdArcade partners — AI-rendered vintage monster companions (90s
 * creature-collector vibe), one per plan tier. TRUE sprite animation: each
 * partner has multiple art frames (base / blink / cheer) generated via img2img
 * from the same render so the character stays consistent, hard-cut like a real
 * video-game flipbook. Layered on top: levitation over a breathing ground
 * shadow, an energy aura, gentle sway, and sparkle twinkles.
 * Files: public/fighters/mons/{img}.png, {img}_b.png (blink), {img}_c.png (cheer). */

export type PlanKey = "STARTER" | "GROWTH" | "PRO" | "SCALE";

export const ART_V = "6"; // bump to bust cache when renders change

export const PARTNER_BY_PLAN: Record<
  PlanKey,
  { tier: 1 | 2 | 3 | 4; accent: string; name: string; klass: string; img: string }
> = {
  STARTER: { tier: 1, accent: "#34E7E4", name: "BYTE", klass: "Rookie", img: "byte" },
  GROWTH: { tier: 2, accent: "#FF3D8B", name: "KILO", klass: "Runner", img: "kilo" },
  PRO: { tier: 3, accent: "#FFB020", name: "MEGA", klass: "Champion", img: "mega" },
  SCALE: { tier: 4, accent: "#B77BFF", name: "GIGA", klass: "Legend", img: "giga" },
};

export function Partner({
  img,
  accent,
  frames = 3,
  className,
}: {
  img: string;
  accent: string;
  /** 3 = full flipbook (base/blink/cheer), 1 = static art (foe etc.) */
  frames?: 1 | 3;
  className?: string;
}) {
  const src = (s: string) => `/fighters/mons/${img}${s}.png?v=${ART_V}`;
  // Per-character stagger so the roster never animates in unison — each partner
  // starts mid-cycle at its own offset via negative animation-delay (brand.css
  // also multiplies this for the sway/float/aura layers). Quarter-cycle spread
  // across the four partners = maximum visual desync. Deterministic, so server
  // and client render identically (no hydration mismatch).
  const STAGGER: Record<string, number> = { byte: 0, kilo: -0.3, mega: -0.6, giga: -0.9, chaos: -0.45 };
  const stagger = STAGGER[img] ?? -((img.length * 7) % 11) / 10;
  return (
    <span
      className={`mm-mech${frames >= 3 ? " f3" : ""}${className ? " " + className : ""}`}
      style={{ ["--acc" as string]: accent, ["--fd" as string]: `${stagger}s` }}
      aria-hidden="true"
    >
      <span className="mm-mech-aura" />
      <span className="mm-mech-shadow" />
      <span className="mm-mech-stage">
        <img className="mm-mech-img mf-a" src={src("")} alt="" draggable={false} />
        {frames >= 3 && <img className="mm-mech-img mf-b" src={src("_b")} alt="" draggable={false} />}
        {frames >= 3 && <img className="mm-mech-img mf-c" src={src("_c")} alt="" draggable={false} />}
      </span>
    </span>
  );
}
