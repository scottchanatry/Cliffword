import { judgeSentence, scoreCliffAnswer, scoreWords, scoringContext } from '@cliffword/engine';
import { FakeClock } from '../adapters/clock/FakeClock';
import { systemClock } from '../adapters/clock/systemClock';
import { ExpoHapticsAdapter } from '../adapters/haptics/ExpoHapticsAdapter';
import { FakeHaptics } from '../adapters/haptics/FakeHaptics';
import { FakeModelManager } from '../adapters/model/FakeModelManager';
import { MockModelAdapter } from '../adapters/model/MockModelAdapter';
import { FakeMusicPlayer } from '../adapters/music/FakeMusicPlayer';
import { UnsupportedMusicPlayer } from '../adapters/music/UnsupportedMusicPlayer';
import { MemoryShareInbox } from '../adapters/share/MemoryShareInbox';
import { FakeSpeechIn } from '../adapters/speechIn/FakeSpeechIn';
import { TypedSpeechIn } from '../adapters/speechIn/TypedSpeechIn';
import { ExpoSpeechOut } from '../adapters/speechOut/ExpoSpeechOut';
import { FakeSpeechOut } from '../adapters/speechOut/FakeSpeechOut';
import { getDefaultPairPack } from '../engine/PacksProvider';
import { getAppServices, setAppServices } from './appServices';
import { defaultPacks } from './defaults';
import { createServices, currentPlatform } from './Services';
import { createStorageService } from './storageService';
import { createTestServices } from './testServices';
import { createWebServices } from './webServices';

describe('createTestServices', () => {
  it('builds every service as a fake or in-memory, on one FakeClock', () => {
    const s = createTestServices();
    expect(s.platform).toBe('test');
    expect(s.clock).toBeInstanceOf(FakeClock);
    expect(s.model).toBeInstanceOf(MockModelAdapter);
    expect(s.modelManager).toBeInstanceOf(FakeModelManager);
    expect(s.speechOut).toBeInstanceOf(FakeSpeechOut);
    expect(s.speechIn).toBeInstanceOf(FakeSpeechIn);
    expect(s.music).toBeInstanceOf(FakeMusicPlayer);
    expect(s.share).toBeInstanceOf(MemoryShareInbox);
    expect(s.haptics).toBeInstanceOf(FakeHaptics);
    expect(s.storage.backend).toBe('sql.js-memory');
    expect(s.model.status).toBe('ready');
    expect(s.modelManager.status()).toBe('ready');
  });

  it('gives a model that scores a Spanish sentence through the engine', async () => {
    const { model, packs } = createTestServices();
    expect(packs.lang.code).toBe('es');
    expect(packs.pair.target).toBe('es');

    const context = scoringContext(packs.lang, '');
    const plain = await scoreWords(model, packs.lang, context, 'Marta llegó tarde al mercado.');
    expect(plain.map((w) => w.segment.text)).toEqual(['Marta', 'llegó', 'tarde', 'al', 'mercado']);
    expect(plain.every((w) => Number.isFinite(w.logprob) && w.surprisal >= 0)).toBe(true);

    const odd = await scoreWords(model, packs.lang, context, 'Marta llegó tarde al elefante.');
    expect(odd[4]?.surprisal).toBeGreaterThan(plain[4]?.surprisal ?? Infinity);

    const judgement = await judgeSentence(model, packs.lang, '', 'Ella es cansada.', { register: 'neutral' });
    expect(judgement.verdict).not.toBe('ok');

    const cliff = await scoreCliffAnswer(model, packs.lang, 'Marta llegó tarde al', 'mercado', 'mercado');
    expect(cliff.credit).toBe('full');
  });

  it('shares the clock across fakes, so advancing it moves durations', async () => {
    const s = createTestServices();
    await s.speechIn.start({ lang: 'es-ES', onDevice: true, interim: false });
    const finals: number[] = [];
    s.speechIn.onFinal((t) => finals.push(t.durationMs));
    s.clock.advance(1234);
    s.speechIn.emitFinal('otra vez');
    expect(finals).toEqual([1234]);

    const item = s.share.receive({ text: 'Despacito - Luis Fonsi' });
    expect(item?.receivedAt).toBe(s.clock.now());
  });

  it('takes overrides, typed as given, and builds the rest on the override clock', () => {
    const clock = new FakeClock(1000);
    const typed = new TypedSpeechIn();
    const storage = createStorageService('sql.js-memory', () => Promise.reject(new Error('stub')));
    const s = createTestServices({ clock, speechIn: typed, storage });
    expect(s.speechIn).toBe(typed);
    expect(s.speechIn.kind).toBe('typed');
    expect(s.storage).toBe(storage);
    expect(s.share.receive({ text: 'x' })?.receivedAt).toBe(1000);
    // The model is still the concrete fake type.
    s.model.failNextLoad(new Error('typed as MockModelAdapter'));
  });

  it('reuses the packs and the trained mock model, but not adapter state', async () => {
    const a = createTestServices();
    const b = createTestServices();
    expect(a.packs).toBe(b.packs);
    expect(a.packs).toBe(defaultPacks());
    expect(a.packs.pair).toBe(getDefaultPairPack());
    expect(a.model).not.toBe(b.model);
    await a.model.unload();
    expect(b.model.status).toBe('ready');
    expect(a.clock).not.toBe(b.clock);
  });
});

describe('createWebServices', () => {
  it('uses the mock model, browser voices and no Apple Music', () => {
    const s = createWebServices({}, {});
    expect(s.platform).toBe('web');
    expect(s.clock).toBe(systemClock);
    expect(s.model).toBeInstanceOf(MockModelAdapter);
    expect(s.modelManager.status()).toBe('ready');
    expect(s.speechOut).toBeInstanceOf(ExpoSpeechOut);
    expect(s.speechIn.kind).toBe('typed');
    expect(s.music).toBeInstanceOf(UnsupportedMusicPlayer);
    expect(s.share).toBeInstanceOf(MemoryShareInbox);
    expect(s.haptics).toBeInstanceOf(ExpoHapticsAdapter);
  });

  it('uses the browser recognizer when the page has one', () => {
    class Recognition {
      lang = '';
      interimResults = false;
      continuous = false;
      maxAlternatives = 1;
      onstart = null;
      onresult = null;
      onerror = null;
      onend = null;
      start() {}
      stop() {}
      abort() {}
    }
    expect(createWebServices({}, { webkitSpeechRecognition: Recognition }).speechIn.kind).toBe('browser');
  });
});

describe('createServices', () => {
  it('builds per platform', () => {
    expect(createServices('web').platform).toBe('web');
    for (const platform of ['ios', 'android'] as const) {
      const s = createServices(platform);
      expect(s.platform).toBe(platform);
      expect(s.model).toBeInstanceOf(MockModelAdapter);
      expect(s.speechOut).toBeInstanceOf(ExpoSpeechOut);
      expect(s.speechIn).toBeInstanceOf(TypedSpeechIn);
      expect(s.music.available).toBe(false);
      expect(s.storage.backend).toBe('expo-sqlite');
    }
  });

  it('applies overrides on every platform', () => {
    const music = new FakeMusicPlayer();
    expect(createServices('ios', { music }).music).toBe(music);
    expect(createServices('web', { music }).music).toBe(music);
    expect(createTestServices({ music }).music).toBe(music);
  });

  it('maps Platform.OS and builds the app container once', () => {
    expect(currentPlatform('ios')).toBe('ios');
    expect(currentPlatform('android')).toBe('android');
    expect(currentPlatform('web')).toBe('web');
    expect(currentPlatform('windows')).toBe('web');
    expect(currentPlatform()).toBe('ios'); // jest-expo's default platform
    expect(getAppServices()).toBe(getAppServices());
    expect(getAppServices().platform).toBe('ios');
  });

  it('lets route tests install their own app container', () => {
    const test = createTestServices();
    setAppServices(test);
    expect(getAppServices()).toBe(test);
    setAppServices(undefined);
    expect(getAppServices().platform).toBe('ios');
  });
});

describe('storage in the container', () => {
  it('opens a migrated in-memory database for tests, once, on the container clock', async () => {
    const s = createTestServices();
    const first = s.storage.open();
    expect(s.storage.open()).toBe(first);
    const storage = await first;
    expect(await storage.db.get<{ user_version: number }>('PRAGMA user_version')).toEqual({ user_version: 2 });
    s.clock.set(5000);
    const story = await storage.stories.create({ title: 'Cuento' });
    expect(story).toMatchObject({ id: 'test-1', createdAt: 5000 });
    await s.storage.close();
    // A fresh open after close: a new, empty database.
    const again = await s.storage.open();
    expect(again).not.toBe(storage);
    expect(await again.stories.list()).toEqual([]);
    await s.storage.close();
  });

  it('gives every test container its own database', async () => {
    const a = createTestServices();
    const b = createTestServices();
    await (await a.storage.open()).settings.set('onboarded', true);
    expect(await (await b.storage.open()).settings.get('onboarded')).toBe(false);
    await Promise.all([a.storage.close(), b.storage.close()]);
  });

  it('does not open storage until asked, and retries after a failed open', async () => {
    const opener = jest
      .fn<Promise<never>, []>()
      .mockRejectedValueOnce(new Error('locked'))
      .mockImplementationOnce(() => createTestServices().storage.open() as Promise<never>);
    const service = createStorageService('expo-sqlite', opener);
    expect(opener).not.toHaveBeenCalled();
    await expect(service.open()).rejects.toThrow('locked');
    const storage = await service.open();
    expect(opener).toHaveBeenCalledTimes(2);
    expect(await service.open()).toBe(storage);
    expect(opener).toHaveBeenCalledTimes(2);
    await service.close();
  });

});
