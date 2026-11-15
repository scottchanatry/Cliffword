/**
 * What each platform's bundle can reach, from the routes in app/app, following relative imports
 * the way Metro resolves platform files (x.ios.ts / x.native.ts / x.web.ts before x.ts):
 * - test-only code (src/testing, src/storage/testing, createTestServices) is in no bundle;
 * - sql.js is only in the web bundle (in-memory preview storage), expo-sqlite only in native ones.
 * The export step of the verify chain bundles for real; this test catches a wrong import early.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const APP_ROOT = path.resolve(__dirname, '..');
type Platform = 'ios' | 'android' | 'web';

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

function specifiers(file: string): string[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      // Type-only imports are erased and never reach a bundle.
      const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
      if (!typeOnly) found.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0] as ts.Node)) {
      const callee = node.expression;
      if ((ts.isIdentifier(callee) && callee.text === 'require') || callee.kind === ts.SyntaxKind.ImportKeyword) {
        found.push((node.arguments[0] as ts.StringLiteral).text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function resolveRelative(from: string, spec: string, platform: Platform): string | null {
  const base = path.resolve(path.dirname(from), spec);
  const suffixes = platform === 'web' ? ['.web', ''] : [`.${platform}`, '.native', ''];
  const candidates = [
    ...suffixes.flatMap((s) => [`${base}${s}.tsx`, `${base}${s}.ts`, `${base}${s}.js`]),
    ...suffixes.flatMap((s) => [path.join(base, `index${s}.tsx`), path.join(base, `index${s}.ts`)]),
    base,
  ];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

function reach(platform: Platform): { files: Set<string>; packages: Map<string, string[]> } {
  const files = new Set<string>();
  const packages = new Map<string, string[]>();
  const queue = routeFiles(path.join(APP_ROOT, 'app'));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of specifiers(file)) {
      if (spec.startsWith('.')) {
        const resolved = resolveRelative(file, spec, platform);
        if (!resolved) throw new Error(`${path.relative(APP_ROOT, file)}: cannot resolve ${spec} for ${platform}`);
        if (!resolved.includes(`${path.sep}engine${path.sep}`)) queue.push(resolved);
      } else {
        const users = packages.get(spec) ?? [];
        users.push(path.relative(APP_ROOT, file));
        packages.set(spec, users);
      }
    }
  }
  return { files, packages };
}

const rel = (files: Set<string>) => [...files].map((f) => path.relative(APP_ROOT, f).split(path.sep).join('/'));
const isTestOnly = (f: string) =>
  f.startsWith('src/testing/') || f.startsWith('src/storage/testing/') || f === 'src/services/testServices.ts';
const packagesMatching = (packages: Map<string, string[]>, re: RegExp) => [...packages.keys()].filter((p) => re.test(p));

describe.each(['ios', 'android'] as const)('%s bundle', (platform) => {
  const { files, packages } = reach(platform);

  it('reaches the app (routes, bootstrap, services, storage)', () => {
    const list = rel(files);
    expect(list).toEqual(expect.arrayContaining(['app/_layout.tsx', 'src/bootstrap/AppBootstrap.tsx', 'src/services/nativeServices.ts', 'src/storage/open.ts']));
    expect(list).not.toContain('src/storage/open.web.ts');
  });

  it('holds no test-only code', () => {
    expect(rel(files).filter(isTestOnly)).toEqual([]);
  });

  it('uses expo-sqlite and not sql.js', () => {
    expect(packagesMatching(packages, /^expo-sqlite$/)).toHaveLength(1);
    expect(packagesMatching(packages, /^sql\.js/)).toEqual([]);
  });
});

describe('web bundle', () => {
  const { files, packages } = reach('web');

  it('holds no test-only code', () => {
    expect(rel(files)).toContain('src/storage/open.web.ts');
    expect(rel(files).filter(isTestOnly)).toEqual([]);
  });

  it('uses sql.js (in-memory preview storage) and not expo-sqlite', () => {
    expect(packagesMatching(packages, /^expo-sqlite$/)).toEqual([]);
    expect(packages.get('sql.js/dist/sql-wasm-inline.js')).toEqual(['src/storage/sql/sqljs.ts']);
  });
});
