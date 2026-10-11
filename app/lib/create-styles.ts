/* Art styles for the Creator "Make an image" generator — a consumer text-to-
 * image tool (like DeepAI's), NOT the merchant ad formats. Pure data so it's
 * safe on both the client (the style picker) and the server (the prompt suffix
 * appended at generation). `icon` is an Ico name (app/lib/icons.tsx) — the
 * tiles render drawn SVG icons, not emoji (premium, consistent across OSes). */

export interface CreateStyle {
  key: string;
  name: string;
  /** Ico name from app/lib/icons.tsx. */
  icon: string;
  /** Appended to the user's prompt to steer the look. */
  prompt: string;
}

export const CREATE_STYLES: CreateStyle[] = [
  { key: "photo", name: "Realistic", icon: "camera", prompt: "photorealistic, high detail, natural lighting, sharp focus, 50mm photograph" },
  { key: "digital", name: "Digital Art", icon: "palette", prompt: "digital art, vibrant colors, concept art, highly detailed illustration, trending on artstation" },
  { key: "anime", name: "Anime", icon: "sparkle", prompt: "anime style, cel shaded, clean linework, vibrant colors, studio-quality" },
  { key: "3d", name: "3D Render", icon: "box", prompt: "3D render, octane render, soft studio lighting, glossy materials, high detail" },
  { key: "oil", name: "Oil Painting", icon: "brush", prompt: "oil painting, visible brushstrokes, rich texture, classical fine art, dramatic" },
  { key: "watercolor", name: "Watercolor", icon: "droplet", prompt: "watercolor painting, soft washes, paper texture, delicate, hand-painted" },
  { key: "neon", name: "Cyberpunk", icon: "bolt", prompt: "cyberpunk, neon lights, moody, cinematic, futuristic, blade-runner mood" },
  { key: "pixel", name: "Pixel Art", icon: "grid", prompt: "pixel art, 16-bit, crisp pixels, retro game art, limited palette" },
  { key: "fantasy", name: "Fantasy", icon: "wand", prompt: "epic fantasy art, dramatic lighting, painterly, highly detailed, magical" },
  { key: "minimal", name: "Minimalist", icon: "circle", prompt: "minimalist, clean, simple shapes, lots of negative space, flat design, elegant" },
  { key: "comic", name: "Comic", icon: "burst", prompt: "comic book art, bold black ink outlines, halftone dot shading, dynamic, vivid pop-art colors" },
  { key: "sketch", name: "Sketch", icon: "pencil", prompt: "detailed pencil sketch, graphite on paper, fine cross-hatching, hand-drawn, monochrome" },
];

export const CREATE_STYLE_BY_KEY: Record<string, CreateStyle> = Object.fromEntries(
  CREATE_STYLES.map((s) => [s.key, s]),
);
