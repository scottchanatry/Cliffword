/**
 * What each platform's bundle can reach, from the routes in app/app, following relative imports
 * the way Metro resolves platform files (x.ios.ts / x.native.ts / x.web.ts before x.ts):
 * - test-only code (src/testing, src/storage/testing, createTestServices) is in no bundle;
 * - sql.js is only in the web bundle (in-memory preview storage), expo-sqlite only in native ones;
 * - expo-speech-recognition is only in native bundles, required by createNativeSpeechIn.ts alone;
 * - llama.rn is only in native bundles, imported by createDeviceModel.ts alone;
 * - the model download (ExpoModelManager, fileHash, the cliffword-native module in app/modules) is
 *   only in native bundles, reached through createModelManager.ts (web: createModelManager.web.ts);
 * - expo-share-intent is in no bundle: share-in is out of this build (no share extension in
 *   app.json, no ShareIntentBridge in the root layout, no +native-intent); the persistent share
 *   inbox still comes through createNativeShareInbox;
 * - the Apple Music module (app/modules/cliffword-music) is only in native bundles, imported by
 *   createNativeMusicPlayer.ts alone (web: createNativeMusicPlayer.web.ts).
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

/** The reached files that import `target` (app-relative) through a relative import on `platform`. */
function importersOf(files: Set<string>, target: string, platform: Platform): string[] {
  const absolute = path.join(APP_ROOT, target);
  return rel(new Set([...files].filter((file) => specifiers(file).some((spec) => spec.startsWith('.') && resolveRelative(file, spec, platform) === absolute))));
}

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

  it('reaches expo-speech-recognition only through createNativeSpeechIn', () => {
    expect(packagesMatching(packages, /^expo-speech-recognition/)).toEqual(['expo-speech-recognition']);
    expect(packages.get('expo-speech-recognition')).toEqual(['src/adapters/speechIn/createNativeSpeechIn.ts']);
    expect(rel(files)).toEqual(expect.arrayContaining(['src/adapters/speechIn/ExpoSpeechIn.ts']));
    expect(rel(files)).not.toContain('src/adapters/speechIn/createNativeSpeechIn.web.ts');
  });

  it('reaches llama.rn only through createDeviceModel', () => {
    expect(packagesMatching(packages, /^llama\.rn/)).toEqual(['llama.rn']);
    expect(packages.get('llama.rn')).toEqual(['src/adapters/model/createDeviceModel.ts']);
    expect(rel(files)).toEqual(expect.arrayContaining(['src/adapters/model/LlamaModelAdapter.ts']));
    expect(rel(files)).not.toContain('src/adapters/model/createDeviceModel.web.ts');
  });

  it('reaches the model download and the cliffword-native module through createModelManager', () => {
    expect(rel(files)).toEqual(
      expect.arrayContaining([
        'src/adapters/model/createModelManager.ts',
        'src/adapters/model/ExpoModelManager.ts',
        'src/adapters/model/fileHash.ts',
        'modules/cliffword-native/index.ts',
      ]),
    );
    expect(rel(files)).not.toContain('src/adapters/model/createModelManager.web.ts');
    expect(rel(files)).not.toContain('modules/cliffword-native/index.web.ts');
    expect(packages.get('expo-file-system')).toEqual(
      expect.arrayContaining(['src/adapters/model/ExpoModelManager.ts', 'src/adapters/model/fileHash.ts']),
    );
    expect(packages.get('expo-keep-awake')).toEqual(expect.arrayContaining(['src/adapters/model/ExpoModelManager.ts']));
    expect(packages.get('expo')).toEqual(expect.arrayContaining(['modules/cliffword-native/index.ts']));
  });

  it('reaches no expo-share-intent (share-in is out of this build), and the persistent inbox through createNativeShareInbox', () => {
    expect(packagesMatching(packages, /^expo-share-intent/)).toEqual([]);
    const list = rel(files);
    expect(list).toEqual(expect.arrayContaining(['src/adapters/share/createNativeShareInbox.ts', 'src/adapters/share/ExpoShareInbox.ts']));
    expect(list.filter((f) => /ShareIntentBridge|\+native-intent/.test(f))).toEqual([]);
    expect(list).not.toContain('src/adapters/share/createNativeShareInbox.web.ts');
  });

  it('reaches the cliffword-music module only through createNativeMusicPlayer', () => {
    const list = rel(files);
    expect(list).toEqual(
      expect.arrayContaining([
        'src/adapters/music/createNativeMusicPlayer.ts',
        'src/adapters/music/MusicKitPlayer.ts',
        'modules/cliffword-music/index.ts',
      ]),
    );
    expect(list).not.toContain('src/adapters/music/createNativeMusicPlayer.web.ts');
    expect(list).not.toContain('modules/cliffword-music/index.web.ts');
    expect(importersOf(files, 'modules/cliffword-music/index.ts', platform)).toEqual(['src/adapters/music/createNativeMusicPlayer.ts']);
    expect(packages.get('expo')).toEqual(expect.arrayContaining(['modules/cliffword-music/index.ts']));
  });
});

describe('web bundle', () => {
  const { files, packages } = reach('web');

  it('holds no test-only code', () => {
    expect(rel(files)).toContain('src/storage/open.web.ts');
    expect(rel(files).filter(isTestOnly)).toEqual([]);
  });

  it('keeps expo-speech-recognition out (createNativeSpeechIn.web.ts instead)', () => {
    expect(packagesMatching(packages, /^expo-speech-recognition/)).toEqual([]);
    expect(rel(files)).toContain('src/adapters/speechIn/createNativeSpeechIn.web.ts');
    expect(rel(files)).not.toContain('src/adapters/speechIn/createNativeSpeechIn.ts');
    expect(rel(files)).not.toContain('src/adapters/speechIn/ExpoSpeechIn.ts');
  });

  it('keeps llama.rn out (createDeviceModel.web.ts instead)', () => {
    expect(packagesMatching(packages, /^llama\.rn/)).toEqual([]);
    expect(rel(files)).toContain('src/adapters/model/createDeviceModel.web.ts');
    expect(rel(files)).not.toContain('src/adapters/model/createDeviceModel.ts');
    expect(rel(files)).not.toContain('src/adapters/model/LlamaModelAdapter.ts');
  });

  it('keeps the model download out (createModelManager.web.ts, a ready FakeModelManager, instead)', () => {
    const list = rel(files);
    expect(list).toContain('src/adapters/model/createModelManager.web.ts');
    for (const file of ['createModelManager.ts', 'ExpoModelManager.ts', 'fileHash.ts']) {
      expect(list).not.toContain(`src/adapters/model/${file}`);
    }
    expect(list.filter((f) => f.startsWith('modules/cliffword-native/'))).toEqual([]);
    for (const pkg of ['expo-file-system', 'expo-keep-awake']) {
      expect((packages.get(pkg) ?? []).filter((user) => user.startsWith('src/adapters/model/'))).toEqual([]);
    }
  });

  it('keeps expo-share-intent out (an in-memory inbox instead)', () => {
    const list = rel(files);
    expect(packagesMatching(packages, /^expo-share-intent/)).toEqual([]);
    expect(list).toContain('src/adapters/share/createNativeShareInbox.web.ts');
    expect(list.filter((f) => /ShareIntentBridge/.test(f))).toEqual([]);
    expect(list).not.toContain('src/adapters/share/createNativeShareInbox.ts');
  });

  it('keeps the cliffword-music module out (createNativeMusicPlayer.web.ts instead)', () => {
    const list = rel(files);
    expect(list).toContain('src/adapters/music/createNativeMusicPlayer.web.ts');
    expect(list).not.toContain('src/adapters/music/createNativeMusicPlayer.ts');
    expect(list).not.toContain('src/adapters/music/MusicKitPlayer.ts');
    expect(list.filter((f) => f.startsWith('modules/cliffword-music/'))).toEqual([]);
  });

  it('uses sql.js (in-memory preview storage) and not expo-sqlite', () => {
    expect(packagesMatching(packages, /^expo-sqlite$/)).toEqual([]);
    expect(packages.get('sql.js/dist/sql-wasm-inline.js')).toEqual(['src/storage/sql/sqljs.ts']);
  });
});
