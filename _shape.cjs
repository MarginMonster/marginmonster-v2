const fs = require('fs');
const f = 'app/lib/image-generation.server.ts';
let s = fs.readFileSync(f, 'utf8');

const edits = [
  ['function formatLayoutPrompt(key: string, c: Record<string, string>, hero?: string): string {',
   `function formatLayoutPrompt(
  key: string,
  c: Record<string, string>,
  hero?: string,
  /** The finished shape this frame is rendered at. Defaults to the square the
   *  ad formats were designed for; the video keyframe path renders 9:16 and
   *  used to inherit "square 1:1" here, telling the model to compose for one
   *  shape while the model was asked for another. */
  shape = "square 1:1",
): string {`],

  ['const base = `Modern high-converting DTC e-commerce static ad, crisp clean design, square 1:1, professional advertising typography.',
   'const base = `Modern high-converting DTC e-commerce static ad, crisp clean design, ${shape}, professional advertising typography.'],

  // the copy is written in the shop's language; demanding English fights it
  ['Each string appears ONCE and reads as grammatical English — never repeat or stutter a word or phrase inside a sentence ("we still each still got", "first try first try" are failures), never re-render the same line twice.',
   'Each string appears ONCE, in the SAME LANGUAGE it is written in above — reproduce it exactly, never translate it, never transliterate it — and it must read as correct, grammatical text in that language: never repeat or stutter a word or phrase inside a sentence ("we still each still got", "first try first try" are failures), never re-render the same line twice.'],

  // the video keyframe asks for the shape it is actually rendered at
  ['    const prompt = formatLayoutPrompt(f.key, copy);\n',
   '    // Vertical, to match the aspect_ratio this frame is rendered at and the\n    // video it becomes. Passing the default would compose for a square.\n    const prompt = formatLayoutPrompt(f.key, copy, undefined, "vertical 9:16");\n'],
];

for (const [a] of edits) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error('anchor count ' + n + ': ' + a.slice(0, 80)); process.exit(1); }
}
for (const [a, b] of edits) s = s.split(a).join(b);
fs.writeFileSync(f, s);
console.log('shape + language contradictions fixed');
