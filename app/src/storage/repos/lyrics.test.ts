import { openTestStorage } from '../testing/openTestStorage';

describe('LyricsRepo', () => {
  let storage: Awaited<ReturnType<typeof openTestStorage>>;
  beforeEach(async () => {
    storage = await openTestStorage();
  });
  afterEach(() => storage.close());

  it('stores, replaces and removes lyrics for a song', async () => {
    const song = await storage.songs.upsert({ source: 'manual', title: 'Canción' });
    const raw = "Mano, vamo' a janguear\nCon el corillo, 'tá to' brutal";
    const parsed = { lines: raw.split('\n').map((text, i) => ({ i, text })) };
    expect(await storage.lyrics.put(song.id, raw, parsed, 10)).toEqual({ songId: song.id, rawText: raw, parsed, updatedAt: 10 });
    expect(await storage.lyrics.get(song.id)).toEqual({ songId: song.id, rawText: raw, parsed, updatedAt: 10 });

    storage.clock.set(20);
    await storage.lyrics.put(song.id, 'Otra letra', null);
    expect(await storage.lyrics.get(song.id)).toEqual({ songId: song.id, rawText: 'Otra letra', parsed: null, updatedAt: 20 });

    await storage.lyrics.remove(song.id);
    expect(await storage.lyrics.get(song.id)).toBeNull();
  });

  it('needs the song to exist', async () => {
    await expect(storage.lyrics.put('no-song', 'x', null)).rejects.toThrow(/FOREIGN KEY/);
  });
});
