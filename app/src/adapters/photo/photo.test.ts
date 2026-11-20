/**
 * The learner's photo: the fake every other test uses (taken, cancelled, denied, error), the web
 * preview's none, and ExpoPhotoPicker over a scripted expo-image-picker and the in-memory
 * expo-file-system (src/testing/fakeExpoFileSystem.ts): when it asks for a permission, the
 * options it opens the camera and the library with, the copy in <documents>/avatar/, finding a
 * photo after the documents folder moved, and deleting only its own files.
 */
import type { ImagePickerOptions, ImagePickerResult, PermissionResponse } from 'expo-image-picker';
import { FakeClock } from '../clock/FakeClock';
import { fakeFs } from '../../testing/fakeExpoFileSystem';
import { ExpoPhotoPicker, PHOTO_QUALITY, photoExtension, type ImagePickerModule } from './ExpoPhotoPicker';
import { FakePhotoPicker } from './FakePhotoPicker';
import { UnavailablePhotoPicker } from './UnavailablePhotoPicker';

jest.mock('expo-file-system', () => jest.requireActual('../../testing/fakeExpoFileSystem'));

describe('FakePhotoPicker', () => {
  it('stores a photo when one is taken, and finds it until it is removed or lost', async () => {
    const photos = new FakePhotoPicker({ clock: new FakeClock(1000) });
    const taken = await photos.pick('camera');
    expect(taken).toEqual({ kind: 'picked', uri: 'file:///fake/documents/avatar/1000-1.jpg' });
    if (taken.kind !== 'picked') throw new Error('not picked');
    expect(await photos.locate(taken.uri)).toBe(taken.uri);
    const chosen = await photos.pick('library');
    if (chosen.kind !== 'picked') throw new Error('not picked');
    expect(photos.stored()).toEqual([taken.uri, chosen.uri]);
    await photos.remove(taken.uri);
    expect(await photos.locate(taken.uri)).toBeNull();
    photos.lose(chosen.uri);
    expect(await photos.locate(chosen.uri)).toBeNull();
    expect(photos.picks).toEqual(['camera', 'library']);
    expect(photos.removed).toEqual([taken.uri]);
  });

  it('plays the scripted outcomes in order: cancelled, denied, error, then taken again', async () => {
    const photos = new FakePhotoPicker();
    photos.script('cancelled', 'denied', 'error');
    expect(await photos.pick('library')).toEqual({ kind: 'cancelled' });
    expect(await photos.pick('camera')).toEqual({ kind: 'denied', source: 'camera' });
    expect(await photos.pick('camera')).toEqual({ kind: 'error', source: 'camera', message: 'The fake camera failed' });
    expect((await photos.pick('camera')).kind).toBe('picked');
    expect(photos.stored()).toHaveLength(1);
  });

  it('holds a pick while the camera is open', async () => {
    const photos = new FakePhotoPicker();
    const release = photos.hold();
    let done = false;
    const pending = photos.pick('camera').then((r) => {
      done = true;
      return r;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    expect((await pending).kind).toBe('picked');
  });

  it('offers only the sources it was given', async () => {
    const photos = new FakePhotoPicker({ sources: ['library'] });
    expect(await photos.pick('camera')).toEqual({ kind: 'unavailable', source: 'camera' });
  });
});

describe('UnavailablePhotoPicker (web preview)', () => {
  it('offers no source and finds no photo', async () => {
    const photos = new UnavailablePhotoPicker();
    expect(photos.sources).toEqual([]);
    expect(await photos.pick('camera')).toEqual({ kind: 'unavailable', source: 'camera' });
    expect(await photos.locate('file:///docs/avatar/1.jpg')).toBeNull();
    await expect(photos.remove('file:///docs/avatar/1.jpg')).resolves.toBeUndefined();
  });
});

describe('ExpoPhotoPicker', () => {
  const granted: PermissionResponse = { granted: true, status: 'granted' as PermissionResponse['status'], canAskAgain: true, expires: 'never' };
  const refused: PermissionResponse = { granted: false, status: 'denied' as PermissionResponse['status'], canAskAgain: false, expires: 'never' };

  type Call = { fn: string; options?: ImagePickerOptions };

  function scripted(opts: { permission?: PermissionResponse; result?: ImagePickerResult | Error; mimeType?: string } = {}) {
    const calls: Call[] = [];
    const result = (uri: string): ImagePickerResult => {
      if (opts.result instanceof Error) throw opts.result;
      return opts.result ?? { canceled: false, assets: [{ uri, width: 600, height: 600, mimeType: opts.mimeType ?? 'image/jpeg' }] };
    };
    const picker: ImagePickerModule = {
      requestCameraPermissionsAsync: async () => {
        calls.push({ fn: 'requestCameraPermissionsAsync' });
        return opts.permission ?? granted;
      },
      launchCameraAsync: async (options) => {
        calls.push({ fn: 'launchCameraAsync', options });
        fakeFs.writeFile('file:///cache/ImagePicker/camera.jpg', new Uint8Array([1, 2, 3]));
        return result('file:///cache/ImagePicker/camera.jpg');
      },
      launchImageLibraryAsync: async (options) => {
        calls.push({ fn: 'launchImageLibraryAsync', options });
        fakeFs.writeFile('file:///cache/ImagePicker/library.png', new Uint8Array([4, 5, 6, 7]));
        return result('file:///cache/ImagePicker/library.png');
      },
    };
    return { picker, calls };
  }

  let excluded: string[];
  let clock: FakeClock;
  function make(picker: ImagePickerModule) {
    return new ExpoPhotoPicker({ picker, clock, excludeFromBackup: async (uri) => void excluded.push(uri) });
  }

  beforeEach(() => {
    fakeFs.reset({ platform: 'ios' });
    excluded = [];
    clock = new FakeClock(1_763_164_800_000);
  });

  it('asks for the camera only when a selfie is taken, opens the front camera with a square crop, and keeps a copy', async () => {
    const { picker, calls } = scripted();
    const photos = make(picker);
    expect(photos.sources).toEqual(['camera', 'library']);
    expect(calls).toEqual([]);
    const result = await photos.pick('camera');
    expect(result).toEqual({ kind: 'picked', uri: 'file:///docs/avatar/1763164800000.jpg' });
    expect(calls.map((c) => c.fn)).toEqual(['requestCameraPermissionsAsync', 'launchCameraAsync']);
    expect(calls[1]?.options).toEqual({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: PHOTO_QUALITY,
      exif: false,
      base64: false,
      cameraType: 'front',
    });
    expect(PHOTO_QUALITY).toBeCloseTo(0.7);
    expect(fakeFs.readFile('file:///docs/avatar/1763164800000.jpg')).toEqual(new Uint8Array([1, 2, 3]));
    // The picker's copy in the cache is gone; the folder is kept out of backups.
    expect(fakeFs.exists('file:///cache/ImagePicker/camera.jpg')).toBe(false);
    expect(excluded).toEqual(['file:///docs/avatar/', 'file:///docs/avatar/1763164800000.jpg']);
  });

  it('chooses from the library without asking for a permission (images only, square crop)', async () => {
    const { picker, calls } = scripted({ mimeType: 'image/png' });
    const result = await make(picker).pick('library');
    expect(result).toEqual({ kind: 'picked', uri: 'file:///docs/avatar/1763164800000.png' });
    expect(calls.map((c) => c.fn)).toEqual(['launchImageLibraryAsync']);
    expect(calls[0]?.options).toMatchObject({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1] });
    expect(calls[0]?.options).not.toHaveProperty('cameraType');
  });

  it('reads a refused camera as denied and opens nothing', async () => {
    const { picker, calls } = scripted({ permission: refused });
    expect(await make(picker).pick('camera')).toEqual({ kind: 'denied', source: 'camera' });
    expect(calls.map((c) => c.fn)).toEqual(['requestCameraPermissionsAsync']);
    expect(fakeFs.list().filter((f) => f.includes('/avatar/'))).toEqual([]);
  });

  it('reads a launch that fails on a permission as denied', async () => {
    const { picker } = scripted({ result: Object.assign(new Error('Missing camera or camera roll permission.'), { code: 'ERR_MISSING_PERMISSION' }) });
    expect(await make(picker).pick('library')).toEqual({ kind: 'denied', source: 'library' });
  });

  it('changes nothing when the learner cancels', async () => {
    const { picker } = scripted({ result: { canceled: true, assets: null } });
    expect(await make(picker).pick('camera')).toEqual({ kind: 'cancelled' });
    expect(fakeFs.list().filter((f) => f.includes('/avatar/'))).toEqual([]);
  });

  it('reports other failures: no camera, and a copy that could not be made', async () => {
    const noCamera = scripted({ result: new Error('Camera not available on simulator') });
    expect(await make(noCamera.picker).pick('camera')).toEqual({ kind: 'error', source: 'camera', message: 'Camera not available on simulator' });

    const missing = scripted({ result: { canceled: false, assets: [{ uri: 'file:///cache/ImagePicker/gone.jpg', width: 1, height: 1 }] } });
    const result = await make(missing.picker).pick('library');
    expect(result).toMatchObject({ kind: 'error', source: 'library' });
    expect(fakeFs.list().filter((f) => f.includes('/avatar/'))).toEqual([]);
  });

  it('refuses an empty copy (sizes read through toByteCount, BigInt on iOS)', async () => {
    fakeFs.useBigIntSizes();
    const ok = scripted();
    expect((await make(ok.picker).pick('camera')).kind).toBe('picked');
    const picker: ImagePickerModule = {
      ...ok.picker,
      launchImageLibraryAsync: async () => {
        fakeFs.writeFile('file:///cache/ImagePicker/empty.jpg', new Uint8Array(0));
        return { canceled: false, assets: [{ uri: 'file:///cache/ImagePicker/empty.jpg', width: 1, height: 1 }] };
      },
    };
    clock.advance(1);
    const result = await make(picker).pick('library');
    expect(result).toMatchObject({ kind: 'error', source: 'library' });
    expect(fakeFs.list().filter((f) => f.includes('/avatar/'))).toEqual(['file:///docs/avatar/1763164800000.jpg']);
  });

  it('gives two photos taken in the same millisecond different names', async () => {
    const { picker } = scripted();
    const photos = make(picker);
    const a = await photos.pick('camera');
    const b = await photos.pick('camera');
    expect([a, b]).toEqual([
      { kind: 'picked', uri: 'file:///docs/avatar/1763164800000.jpg' },
      { kind: 'picked', uri: 'file:///docs/avatar/1763164800000-1.jpg' },
    ]);
  });

  it('finds a stored photo by name in the current documents folder, and nothing when it is gone', async () => {
    const { picker } = scripted();
    const photos = make(picker);
    const picked = await photos.pick('camera');
    if (picked.kind !== 'picked') throw new Error('not picked');
    expect(await photos.locate(picked.uri)).toBe(picked.uri);
    // The same file, stored when the app's documents folder had another path (iOS moves it).
    expect(await photos.locate('file:///var/mobile/Containers/Data/Application/OLD/Documents/avatar/1763164800000.jpg')).toBe(picked.uri);
    expect(await photos.locate('file:///docs/avatar/1.jpg')).toBeNull();
    expect(await photos.locate('file:///docs/cliffword.db')).toBeNull();
    expect(await photos.locate('not a uri')).toBeNull();
  });

  it('deletes only its own photos', async () => {
    const { picker } = scripted();
    const photos = make(picker);
    const picked = await photos.pick('camera');
    if (picked.kind !== 'picked') throw new Error('not picked');
    fakeFs.writeFile('file:///docs/models/model.gguf', new Uint8Array([9]));
    fakeFs.writeFile('file:///docs/avatar/notes.txt', new Uint8Array([9]));
    await photos.remove('file:///docs/models/model.gguf');
    await photos.remove('file:///docs/avatar/notes.txt');
    await photos.remove('file:///docs/avatar/../models/model.gguf');
    expect(fakeFs.exists('file:///docs/models/model.gguf')).toBe(true);
    expect(fakeFs.exists('file:///docs/avatar/notes.txt')).toBe(true);
    await photos.remove(picked.uri);
    expect(fakeFs.exists(picked.uri)).toBe(false);
    // Removing it again, or a file that never was, does not throw.
    await expect(photos.remove(picked.uri)).resolves.toBeUndefined();
  });

  it('stores under the extension of what was picked', () => {
    expect(photoExtension('file:///a/b.jpeg')).toBe('jpg');
    expect(photoExtension('file:///a/b.PNG')).toBe('png');
    expect(photoExtension('file:///a/b.heic?x=1')).toBe('heic');
    expect(photoExtension('file:///a/b', 'image/webp')).toBe('webp');
    expect(photoExtension('file:///a/b.gif')).toBe('jpg');
    expect(photoExtension('content://media/1', 'image/heif')).toBe('heic');
  });
});
