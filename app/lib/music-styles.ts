// Music genre/mood presets for the Creator "Make music" tab — DeepAI-style
// "options for selection" over the free-text prompt. Pure data (client picker +
// server prompt suffix), no imports, safe on both sides. Mirrors create-styles.
export type MusicStyle = { key: string; name: string; emoji: string; prompt: string };

export const MUSIC_STYLES: MusicStyle[] = [
  { key: "lofi", name: "Lo-fi", emoji: "🎧", prompt: "lo-fi hip-hop, mellow, warm vinyl crackle, relaxed boom-bap beat" },
  { key: "cinematic", name: "Cinematic", emoji: "🎬", prompt: "cinematic orchestral score, epic, sweeping strings and brass, film-trailer energy" },
  { key: "pop", name: "Pop", emoji: "🎤", prompt: "upbeat modern pop, catchy, bright synths, danceable four-on-the-floor" },
  { key: "hiphop", name: "Hip-hop", emoji: "🎙", prompt: "hip-hop / trap instrumental, hard 808s, crisp hi-hats, confident" },
  { key: "edm", name: "EDM", emoji: "🔊", prompt: "energetic EDM, festival build and drop, pulsing synth bass, high energy" },
  { key: "acoustic", name: "Acoustic", emoji: "🎸", prompt: "warm acoustic guitar, intimate, gentle fingerpicking, organic and cozy" },
  { key: "ambient", name: "Ambient", emoji: "🌙", prompt: "ambient, calm, airy pads and soft textures, meditative and spacious" },
  { key: "rock", name: "Rock", emoji: "🎸", prompt: "driving rock, electric guitars, punchy live drums, anthemic" },
  { key: "jazz", name: "Jazz", emoji: "🎷", prompt: "smooth jazz, laid-back, brushed drums, piano and upright bass, late-night lounge" },
  { key: "chiptune", name: "8-bit", emoji: "👾", prompt: "retro 8-bit chiptune, playful arcade melody, square-wave synths" },
];

export const MUSIC_STYLE_BY_KEY: Record<string, MusicStyle> = Object.fromEntries(
  MUSIC_STYLES.map((s) => [s.key, s]),
);
