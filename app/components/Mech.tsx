import { useId } from "react";

/* AdArcade combat mechs — a cohesive line of arcade battle-robots that escalate
 * with each plan tier (SPARK-01 → HAVOC → OVERLORD → OMEGA). Pure SVG so they
 * stay razor-crisp at any size (44px HUD avatar → full card portrait), fully
 * themeable per accent, and cost nothing to render. Built parametrically: the
 * `tier` (1-4) unlocks heavier plating and weapons; `accent` drives every glow. */

export type PlanKey = "STARTER" | "GROWTH" | "PRO" | "SCALE";

export const MECH_BY_PLAN: Record<
  PlanKey,
  { tier: 1 | 2 | 3 | 4; accent: string; name: string; klass: string }
> = {
  STARTER: { tier: 1, accent: "#34E7E4", name: "SPARK-01", klass: "Recon Unit" },
  GROWTH: { tier: 2, accent: "#FF3D8B", name: "HAVOC", klass: "Assault Mech" },
  PRO: { tier: 3, accent: "#FFB020", name: "OVERLORD", klass: "Siege Titan" },
  SCALE: { tier: 4, accent: "#B77BFF", name: "OMEGA", klass: "Omega Prime" },
};

export function Mech({
  tier,
  accent,
  className,
}: {
  tier: 1 | 2 | 3 | 4;
  accent: string;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const chrome = `chrome-${uid}`;
  const chromeDark = `chromeD-${uid}`;
  const glow = `glow-${uid}`;
  const coreGrad = `core-${uid}`;

  const cannon = tier >= 2; // forearm cannons
  const shoulderGun = tier >= 3; // shoulder artillery
  const horns = tier >= 3; // crown / horns
  const wings = tier >= 4; // energy wings
  const blade = tier >= 4; // energy blade

  return (
    <svg
      className={`mm-mech${className ? " " + className : ""}`}
      viewBox="0 0 120 150"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-hidden="true"
      style={{ ["--acc" as string]: accent }}
    >
      <defs>
        <linearGradient id={chrome} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8794ad" />
          <stop offset="0.4" stopColor="#4a5468" />
          <stop offset="1" stopColor="#262d3c" />
        </linearGradient>
        <linearGradient id={chromeDark} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a4256" />
          <stop offset="1" stopColor="#1a1f2b" />
        </linearGradient>
        <radialGradient id={coreGrad} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor={accent} />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </radialGradient>
        <filter id={glow} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* energy wings (tier 4) */}
      {wings && (
        <g className="mm-mech-wings" filter={`url(#${glow})`} opacity="0.9">
          <path d="M60 60 L18 34 L30 70 L60 78 Z" fill={accent} opacity="0.35" />
          <path d="M60 60 L102 34 L90 70 L60 78 Z" fill={accent} opacity="0.35" />
        </g>
      )}

      {/* ground shadow */}
      <ellipse cx="60" cy="144" rx={20 + tier * 2} ry="4" fill="#000" opacity="0.45" />

      {/* legs */}
      <g stroke="#10141c" strokeWidth="1.5">
        <path d="M50 92 L46 128 L44 142 L54 142 L56 118 L58 96 Z" fill={`url(#${chromeDark})`} />
        <path d="M70 92 L74 128 L76 142 L66 142 L64 118 L62 96 Z" fill={`url(#${chromeDark})`} />
        <rect x="43" y="140" width="14" height="6" rx="1.5" fill={`url(#${chrome})`} />
        <rect x="63" y="140" width="14" height="6" rx="1.5" fill={`url(#${chrome})`} />
      </g>
      {/* knee joints */}
      <circle cx="49" cy="112" r="2.4" fill={accent} opacity="0.7" />
      <circle cx="71" cy="112" r="2.4" fill={accent} opacity="0.7" />

      {/* torso */}
      <path
        d="M44 50 L76 50 L74 78 L66 96 L54 96 L46 78 Z"
        fill={`url(#${chrome})`}
        stroke="#10141c"
        strokeWidth="1.6"
      />
      {/* ab panel lines */}
      <g stroke="#10141c" strokeWidth="0.9" opacity="0.7">
        <path d="M52 82 L68 82" />
        <path d="M54 88 L66 88" />
      </g>

      {/* pauldrons — grow with tier */}
      <g stroke="#10141c" strokeWidth="1.6">
        <path
          d={`M44 50 L${34 - tier * 2} 48 L${30 - tier * 2} ${62 + tier * 2} L46 62 Z`}
          fill={`url(#${chrome})`}
        />
        <path
          d={`M76 50 L${86 + tier * 2} 48 L${90 + tier * 2} ${62 + tier * 2} L74 62 Z`}
          fill={`url(#${chrome})`}
        />
      </g>
      {/* pauldron accent trims */}
      <path d={`M${34 - tier * 2} 48 L${30 - tier * 2} ${62 + tier * 2}`} stroke={accent} strokeWidth="1.6" opacity="0.85" />
      <path d={`M${86 + tier * 2} 48 L${90 + tier * 2} ${62 + tier * 2}`} stroke={accent} strokeWidth="1.6" opacity="0.85" />

      {/* shoulder artillery (tier 3+) */}
      {shoulderGun && (
        <g stroke="#10141c" strokeWidth="1.2">
          <rect x={26 - tier * 2} y="40" width="10" height="6" rx="1.5" fill={`url(#${chromeDark})`} />
          <rect x={84 + tier * 2} y="40" width="10" height="6" rx="1.5" fill={`url(#${chromeDark})`} />
          <circle cx={31 - tier * 2} cy="43" r="1.6" fill={accent} />
          <circle cx={89 + tier * 2} cy="43" r="1.6" fill={accent} />
        </g>
      )}

      {/* arms */}
      <g stroke="#10141c" strokeWidth="1.5">
        <path d="M34 58 L28 82 L34 84 L40 62 Z" fill={`url(#${chromeDark})`} />
        <path d="M86 58 L92 82 L86 84 L80 62 Z" fill={`url(#${chromeDark})`} />
        {/* fists */}
        <rect x="26" y="82" width="10" height="10" rx="2" fill={`url(#${chrome})`} />
        <rect x="84" y="82" width="10" height="10" rx="2" fill={`url(#${chrome})`} />
      </g>

      {/* forearm cannons (tier 2+) */}
      {cannon && (
        <g stroke="#10141c" strokeWidth="1.2">
          <rect x="24" y="92" width="12" height="5" rx="1.5" fill={`url(#${chromeDark})`} />
          <circle cx="30" cy="94.5" r="1.6" fill={accent} className="mm-mech-optic" />
          {!blade && <rect x="84" y="92" width="12" height="5" rx="1.5" fill={`url(#${chromeDark})`} />}
          {!blade && <circle cx="90" cy="94.5" r="1.6" fill={accent} className="mm-mech-optic" />}
        </g>
      )}

      {/* energy blade (tier 4) — held in right hand */}
      {blade && (
        <g filter={`url(#${glow})`}>
          <path d="M89 84 L92 40 L95 84 Z" fill={accent} opacity="0.9" />
          <path d="M89 84 L92 52 L95 84 Z" fill="#fff" opacity="0.6" />
        </g>
      )}

      {/* reactor core */}
      <circle cx="60" cy="68" r={11 + tier} fill={`url(#${coreGrad})`} className="mm-mech-core" filter={`url(#${glow})`} />
      <circle cx="60" cy="68" r={5 + tier * 0.6} fill={accent} />
      <circle cx="60" cy="68" r={5 + tier * 0.6} fill="none" stroke="#10141c" strokeWidth="1" />
      <circle cx="60" cy="68" r="1.8" fill="#fff" />

      {/* neck */}
      <rect x="55" y="42" width="10" height="10" fill={`url(#${chromeDark})`} stroke="#10141c" strokeWidth="1.2" />

      {/* head / helmet */}
      <path
        d="M48 20 L72 20 L74 34 L66 44 L54 44 L46 34 Z"
        fill={`url(#${chrome})`}
        stroke="#10141c"
        strokeWidth="1.6"
      />
      {/* visor optic */}
      <g filter={`url(#${glow})`}>
        <path d="M50 30 L70 30 L67 36 L53 36 Z" fill={accent} className="mm-mech-optic" />
      </g>

      {/* horns / crown (tier 3+) */}
      {horns && (
        <g stroke="#10141c" strokeWidth="1.2">
          <path d="M48 20 L42 8 L50 16 Z" fill={`url(#${chrome})`} />
          <path d="M72 20 L78 8 L70 16 Z" fill={`url(#${chrome})`} />
          {tier >= 4 && <path d="M60 20 L60 6 L64 12 L60 18 L56 12 Z" fill={accent} filter={`url(#${glow})`} />}
        </g>
      )}
      {/* antenna (tier 1-2) */}
      {tier < 3 && (
        <g stroke={accent} strokeWidth="1.4">
          <path d="M56 20 L54 10" />
          {tier >= 2 && <path d="M64 20 L66 10" />}
          <circle cx="54" cy="9" r="1.6" fill={accent} className="mm-mech-optic" stroke="none" />
          {tier >= 2 && <circle cx="66" cy="9" r="1.6" fill={accent} className="mm-mech-optic" stroke="none" />}
        </g>
      )}
    </svg>
  );
}
