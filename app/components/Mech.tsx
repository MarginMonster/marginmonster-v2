/* AdArcade combat mechs — AI-rendered cyber-ninja battle robots (Cyrax vibe),
 * one per plan tier. Transparent PNG cutouts in public/fighters/mechs, presented
 * as a premium floating hero: an energy aura pulses behind, the mech levitates on
 * a breathing ground shadow, and a metallic light-glint sweeps across the chassis
 * (masked to the silhouette). Shared by the Plans select screen + global HUD. */

export type PlanKey = "STARTER" | "GROWTH" | "PRO" | "SCALE";

export const MECH_V = "2"; // bump to bust cache when renders change

export const MECH_BY_PLAN: Record<
  PlanKey,
  { tier: 1 | 2 | 3 | 4; accent: string; name: string; klass: string; img: string }
> = {
  STARTER: { tier: 1, accent: "#34E7E4", name: "SPARK-01", klass: "Recon Unit", img: "spark" },
  GROWTH: { tier: 2, accent: "#FF3D8B", name: "HAVOC", klass: "Assault Mech", img: "havoc" },
  PRO: { tier: 3, accent: "#FFB020", name: "OVERLORD", klass: "Siege Titan", img: "overlord" },
  SCALE: { tier: 4, accent: "#B77BFF", name: "OMEGA", klass: "Omega Prime", img: "omega" },
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
  const src = `/fighters/mechs/${img}.png?v=${MECH_V}`;
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
