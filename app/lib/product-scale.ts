/* Size classes, shared by the server (which builds the prompt brief) and the
 * Studio (which renders the picker). Kept OUT of product-scale.server.ts on
 * purpose: Remix strips .server modules from the client bundle, so a component
 * importing them fails the build. */

export type SizeClass = "palm" | "two-hand" | "large" | "floor";

/** Merchant-facing options, smallest first — the order they appear in the
 *  picker. `cm` is the representative longest dimension each class implies. */
export const SIZE_CHOICES: { key: SizeClass; label: string; cm: number }[] = [
  { key: "palm", label: "Fits in a palm", cm: 12 },
  { key: "two-hand", label: "Two hands", cm: 35 },
  { key: "large", label: "Large — chest-sized", cm: 60 },
  { key: "floor", label: "Floor-standing", cm: 120 },
];

export function classifySize(cm: number): SizeClass {
  if (cm <= 18) return "palm";
  if (cm <= 45) return "two-hand";
  if (cm <= 90) return "large";
  return "floor";
}
