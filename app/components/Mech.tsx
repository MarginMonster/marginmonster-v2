/* AdArcade partners — AI-rendered vintage monster companions (90s
 * creature-collector vibe), one per plan tier. Your plan = your partner; higher
 * tiers are later evolution stages (BYTE → KILO → MEGA → GIGA). Transparent PNG
 * cutouts in public/fighters/mons, presented as a floating hero: energy aura
 * behind, levitation over a breathing ground shadow, and a light-glint sweep
 * masked to the silhouette. Shared by the Plans select screen + global HUD. */

export type PlanKey = "STARTER" | "GROWTH" | "PRO" | "SCALE";

export const MECH_V = "2"; // bump to bust cache when renders change

export const MECH_BY_PLAN: Record<
  PlanKey,
  { tier: 1 | 2 | 3 | 4; accent: string; name: string; klass: string; img: string }
> = {
  STARTER: { tier: 1, accent: "#34E7E4", name: "BYTE", klass: "Rookie", img: "byte" },
  GROWTH: { tier: 2, accent: "#FF3D8B", name: "KILO", klass: "Runner", img: "kilo" },
  PRO: { tier: 3, accent: "#FFB020", name: "MEGA", klass: "Champion", img: "mega" },
  SCALE: { tier: 4, accent: "#B77BFF", name: "GIGA", klass: "Legend", img: "giga" },
};

export function Mech({
  img,
  accent,
  className,
}: {
  img: string;
  accent: string;
  className?: string;
}) {
  const src = `/fighters/mons/${img}.png?v=${MECH_V}`;
  return (
    <span
      className={`mm-mech${className ? " " + className : ""}`}
      style={{ ["--acc" as string]: accent }}
      aria-hidden="true"
    >
      <span className="mm-mech-aura" />
      <span className="mm-mech-shadow" />
      <img className="mm-mech-img" src={src} alt="" draggable={false} />
      <span className="mm-mech-sweep" style={{ ["--img" as string]: `url("${src}")` }} />
    </span>
  );
}
