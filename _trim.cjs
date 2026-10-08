const fs = require('fs');
function patch(file, pairs, imp) {
  let s = fs.readFileSync(file, 'utf8');
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  for (const [a, b] of pairs) {
    const n = s.split(a).length - 1;
    if (n !== 1) { console.error('anchor ' + n + ' in ' + file + ': ' + a.slice(0, 70)); process.exit(1); }
    s = s.split(a).join(b);
  }
  if (imp && !s.includes(imp)) {
    const m = s.match(/^import .*from "\.\/[^"]+";$/m);
    if (!m) { console.error('no import anchor in ' + file); process.exit(1); }
    s = s.replace(m[0], m[0] + nl + imp);
  }
  fs.writeFileSync(file, s);
  console.log('patched ' + file);
}

patch('app/lib/image-generation.server.ts', [
  ['`The merchant IS running this promotion, word for word: "${merchantOffer.slice(0, 60)}". Use it verbatim wherever an offer appears.`',
   '`The merchant IS running this promotion, word for word: "${trimToWord(merchantOffer, 60)}". Use it verbatim wherever an offer appears.`'],
  ['out.offer = merchantOffer ? merchantOffer.slice(0, 40) : invented ? "Own the set" : out.offer;',
   'out.offer = merchantOffer ? trimToWord(merchantOffer, 40) : invented ? "Own the set" : out.offer;'],
], 'import { trimToWord } from "./text-trim";');

patch('app/lib/commercial-ad-pipeline.server.ts', [
  ['    scene: String(b.scene || "").slice(0, 300),\n    motion: String(b.motion || "slow cinematic push-in").slice(0, 120),\n    narration: String(b.narration || "").slice(0, 140),',
   '    scene: trimToWord(String(b.scene || ""), 300),\n    motion: trimToWord(String(b.motion || "slow cinematic push-in"), 120),\n    // Narration is SPOKEN — a mid-word cut is audible.\n    narration: trimToWord(String(b.narration || ""), 140),'],
  ['  j.tagline = String(j.tagline || productTitle).slice(0, 60);',
   '  // The tagline is burned into the end card AND read aloud, so a hard cut is\n  // both seen and heard.\n  j.tagline = trimToWord(String(j.tagline || productTitle), 60);'],
  ['  if (pin) j.tagline = pin[1].slice(0, 60);',
   '  if (pin) j.tagline = trimToWord(pin[1], 60);'],
], 'import { trimToWord } from "./text-trim";');

patch('app/lib/video-generation.server.ts', [
  ['    ? ` Product context: ${productDescription.trim().slice(0, 200)}.`',
   '    ? ` Product context: ${trimToWord(productDescription, 200)}.`'],
], 'import { trimToWord } from "./text-trim";');
