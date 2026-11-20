/**
 * One shared skin for every illustrated person (assets/illustrations/README.md, "Skin"), like
 * the default emoji yellow: nobody, from any story or country, is drawn darker or lighter than
 * anyone else.
 *
 * - Every element marked class="skin" (or "skin-shade") in any source is painted with SKIN (or
 *   SKIN_SHADE), the colors defined once in scripts/make-illustrations.js: its fill, or its
 *   stroke when the fill is "none" (tube arms and legs, fingers drawn as lines).
 * - Every picture that shows a person marks its skin: every cast picture but the animals (new
 *   cast files are covered as they appear), plus the scenes and covers listed below.
 */
import fs from 'fs';
import path from 'path';

const APP = path.join(__dirname, '../..');
const SRC = path.join(APP, 'assets/illustrations/src');
const GROUPS = ['covers', 'scenes', 'cast', 'vocab'] as const;

/** Cast pictures that are not people. */
const ANIMAL_CAST = ['pancho'];
/** Pictures outside the cast that show a person (face, hands or any other skin). */
const PEOPLE: Record<Exclude<(typeof GROUPS)[number], 'cast'>, string[]> = {
  scenes: ['e1-street', 'e2-colmado', 'e3-clothes', 'e5-driving', 'e8-party'],
  covers: [],
  vocab: [],
};

const SCRIPT = fs.readFileSync(path.join(APP, 'scripts/make-illustrations.js'), 'utf8');
function constant(name: string): string {
  const match = SCRIPT.match(new RegExp(`const ${name} = '(#[0-9A-F]{6})';`));
  if (!match) throw new Error(`scripts/make-illustrations.js defines no ${name}`);
  return match[1] ?? '';
}
const PAINT: Record<string, string> = { skin: constant('SKIN'), 'skin-shade': constant('SKIN_SHADE') };

interface Painted {
  line: number;
  tag: string;
  kind: string;
  fill: string;
  stroke: string;
  style?: string;
}

/** Every element marked as skin, with the fill and stroke it gets (its own or inherited). */
function skinElements(svg: string): Painted[] {
  const found: Painted[] = [];
  const stack: { fill: string; stroke: string }[] = [{ fill: '#000000', stroke: 'none' }];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g)) {
    const [, closing, name = '', rawAttrs = '', selfClosing] = m;
    if (closing) {
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1] ?? ''] = a[2] ?? '';
    const parent = stack[stack.length - 1] ?? { fill: '#000000', stroke: 'none' };
    const paint = { fill: (attrs.fill ?? parent.fill).toUpperCase(), stroke: (attrs.stroke ?? parent.stroke).toUpperCase() };
    const kind = (attrs.class ?? '').split(/\s+/).find((c) => c in PAINT);
    if (kind) {
      const line = svg.slice(0, m.index).split('\n').length;
      found.push({ line, tag: name, kind, ...paint, style: attrs.style });
    }
    if (!selfClosing) stack.push(paint);
  }
  return found;
}

const sources = GROUPS.flatMap((group) =>
  fs
    .readdirSync(path.join(SRC, group))
    .filter((f) => f.endsWith('.svg'))
    .sort()
    .map((f) => ({ group, id: f.slice(0, -4), file: path.join(SRC, group, f) })),
);
const people = sources.filter(({ group, id }) => (group === 'cast' ? !ANIMAL_CAST.includes(id) : PEOPLE[group].includes(id)));

describe('one shared skin', () => {
  it('takes the skin colors from the render script', () => {
    expect(PAINT.skin).toMatch(/^#[0-9A-F]{6}$/);
    expect(PAINT['skin-shade']).toMatch(/^#[0-9A-F]{6}$/);
    expect(PAINT['skin-shade']).not.toBe(PAINT.skin);
    expect(SCRIPT).toMatch(/applySkin\(/);
  });

  it.each(sources.map((s) => [`${s.group}/${s.id}`, s.file]))('%s: every skin element has the shared skin', (_name, file) => {
    const wrong = skinElements(fs.readFileSync(file, 'utf8'))
      .filter((e) => e.style !== undefined || (e.fill === 'NONE' ? e.stroke : e.fill) !== PAINT[e.kind])
      .map((e) => `line ${e.line}: <${e.tag} class="${e.kind}"> fill ${e.fill}, stroke ${e.stroke}${e.style ? `, style "${e.style}"` : ''}`);
    expect(wrong).toEqual([]);
  });

  it.each(people.map((s) => [`${s.group}/${s.id}`, s.file]))('%s shows a person and marks the skin with class="skin"', (_name, file) => {
    expect(skinElements(fs.readFileSync(file, 'utf8')).filter((e) => e.kind === 'skin').length).toBeGreaterThan(0);
  });

  it('lists only pictures that exist', () => {
    const ids = new Set(sources.map((s) => `${s.group}/${s.id}`));
    const listed = [
      ...ANIMAL_CAST.map((id) => `cast/${id}`),
      ...Object.entries(PEOPLE).flatMap(([group, list]) => list.map((id) => `${group}/${id}`)),
    ];
    expect(listed.filter((name) => !ids.has(name))).toEqual([]);
  });
});
