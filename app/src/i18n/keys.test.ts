/**
 * Every translation key used in the app source exists in the English catalog or in the
 * en-es pair pack's ui strings, and components carry no hard-coded interface text.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import { createDefaultPairPack } from '@cliffword/engine';
import { en } from './catalog';

const APP_ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['src', 'app'].map((d) => path.join(APP_ROOT, d));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

const files = SCAN_DIRS.flatMap(sourceFiles);
/** Source without comments, so examples in doc comments are not counted as uses. */
const read = (f: string) =>
  fs
    .readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/.*$/gm, '$1');
const rel = (f: string) => path.relative(APP_ROOT, f);

function matches(re: RegExp): { key: string; file: string }[] {
  return files.flatMap((file) => [...read(file).matchAll(re)].map((m) => ({ key: m[2] ?? '', file: rel(file) })));
}

describe('translation keys', () => {
  const pairUi = createDefaultPairPack().ui;
  const known = (key: string) => key in en || key in pairUi;

  const plainKeys = [
    ...matches(/\bt\(\s*(['"])([^'"\n]+)\1/g),
    ...matches(/\btKey\(\s*(['"])([^'"\n]+)\1/g),
  ];
  const pluralKeys = matches(/\bplural\(\s*(['"])([^'"\n]+)\1/g);

  it('finds the keys used in the source', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(plainKeys.length).toBeGreaterThan(30);
    expect(pluralKeys.length).toBeGreaterThan(0);
  });

  it('has every t() and tKey() key in the catalog or pair.ui', () => {
    const missing = plainKeys.filter(({ key }) => !known(key));
    expect(missing).toEqual([]);
  });

  it('has .one and .other for every plural() key', () => {
    const missing = pluralKeys.filter(({ key }) => !known(`${key}.one`) || !known(`${key}.other`));
    expect(missing).toEqual([]);
  });

  it('uses no placeholder in a .one form that its .other form lacks', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const catalog: Record<string, string> = en;
    for (const key of Object.keys(catalog).filter((k) => k.endsWith('.one'))) {
      const other = catalog[key.replace(/\.one$/, '.other')];
      expect(other).toBeDefined();
      const otherVars = vars(other ?? '');
      expect(vars(catalog[key] ?? '').filter((v) => !otherVars.includes(v))).toEqual([]);
    }
  });
});

describe('no hard-coded interface text in components', () => {
  /** JSX props that carry text a person reads or hears. */
  const TEXT_PROPS = new Set([
    'label',
    'title',
    'hint',
    'actionLabel',
    'value',
    'accessibilityLabel',
    'accessibilityHint',
    'placeholder',
  ]);
  /** Object keys that carry text in navigator options (Stack.Screen / Tabs.Screen options). */
  const OPTION_TEXT_KEYS = new Set(['title', 'headerTitle', 'headerBackTitle', 'tabBarLabel', 'tabBarAccessibilityLabel']);
  /** Any visible content: letters, digits or punctuation (a time like "0:00" is formatted text too). */
  const hasContent = (text: string) => text.trim().length > 0;

  /** The literal text of a string or template expression, or null for anything else. */
  function literalOf(node: ts.Node | undefined): string | null {
    if (!node) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('');
    if (ts.isJsxExpression(node)) return literalOf(node.expression);
    if (ts.isParenthesizedExpression(node)) return literalOf(node.expression);
    return null;
  }

  /**
   * Literal text in JSX children ("Hello", {'Hello'}, {`Hello ${x}`}), in text props
   * (label="Skip", label={'Skip'}) and in navigator option objects ({ title: 'Story' }).
   */
  function literalText(file: string): string[] {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) && hasContent(node.text)) found.push(node.text.trim());
      if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
        const text = literalOf(node.expression);
        if (text !== null && hasContent(text)) found.push(`{${JSON.stringify(text)}}`);
      }
      if (ts.isJsxAttribute(node) && TEXT_PROPS.has(node.name.getText(source))) {
        const text = literalOf(node.initializer);
        if (text !== null && hasContent(text)) found.push(`${node.name.getText(source)}=${JSON.stringify(text)}`);
      }
      if (ts.isPropertyAssignment(node) && OPTION_TEXT_KEYS.has(node.name.getText(source))) {
        const text = literalOf(node.initializer);
        if (text !== null && hasContent(text)) found.push(`${node.name.getText(source)}: ${JSON.stringify(text)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found.map((text) => `${rel(file)}: ${text}`);
  }

  it('finds literal text when there is some', () => {
    const probe = path.join(os.tmpdir(), `cw-probe-${process.pid}.tsx`);
    fs.writeFileSync(
      probe,
      [
        'export const A = () => (',
        '  <Text>',
        '    Hello',
        '  </Text>',
        ');',
        'export const B = () => <Button label="Skip" />;',
        "export const C = () => <Text>{'Hi'}{' '}{`${n} left`}</Text>;",
        "export const D = () => <Button label={'Go'} accessibilityHint={`Opens ${x}`} />;",
        'export const E = () => <Text>0:00</Text>;',
        "export const F = () => <Tabs.Screen options={{ title: 'Story', tabBarIcon: () => null }} />;",
        "export const G = () => <Text>{t('ok')}</Text>;",
      ].join('\n'),
    );
    try {
      const found = literalText(probe).map((f) => f.slice(f.indexOf(': ') + 2));
      expect(found).toEqual(['Hello', 'label="Skip"', '{"Hi"}', '{" left"}', 'label="Go"', 'accessibilityHint="Opens "', '0:00', 'title: "Story"']);
    } finally {
      fs.unlinkSync(probe);
    }
  });

  it('has none in app/ and src/', () => {
    const tsx = files.filter((f) => f.endsWith('.tsx'));
    expect(tsx.flatMap(literalText)).toEqual([]);
  });
});
