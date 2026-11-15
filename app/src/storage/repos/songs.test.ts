import { openTestStorage } from '../testing/openTestStorage';

describe('SongRepo', () => {
  let storage: Awaited<ReturnType<typeof openTestStorage>>;
  beforeEach(async () => {
    storage = await openTestStorage();
  });
  afterEach(() => storage.close());

  it('adds an Apple Music song once and updates it when added again', async () => {
    const first = await storage.songs.upsert({ source: 'apple_music', externalId: '1440857781', title: 'Tití Me Preguntó', artist: 'Bad Bunny', addedAt: 1 });
    expect(first).toEqual({
      id: 'id-1',
      source: 'apple_music',
      externalId: '1440857781',
      title: 'Tití Me Preguntó',
      artist: 'Bad Bunny',
      artworkUrl: null,
      addedAt: 1,
    });
    const again = await storage.songs.upsert({
      source: 'apple_music',
      externalId: '1440857781',
      title: 'Tití Me Preguntó (Remix)',
      artist: 'Bad Bunny',
      artworkUrl: 'https://example.com/a.jpg',
      addedAt: 99,
    });
    expect(again).toEqual({ ...first, title: 'Tití Me Preguntó (Remix)', artworkUrl: 'https://example.com/a.jpg' });
    expect(await storage.songs.list()).toHaveLength(1);
  });

  it('keeps the same external id from different sources apart', async () => {
    await storage.songs.upsert({ source: 'apple_music', externalId: 'x1', title: 'A' });
    await storage.songs.upsert({ source: 'spotify_share', externalId: 'x1', title: 'B' });
    expect((await storage.songs.findByExternal('spotify_share', 'x1'))?.title).toBe('B');
    expect((await storage.songs.findByExternal('apple_music', 'x1'))?.title).toBe('A');
    expect(await storage.songs.findByExternal('apple_music', 'nope')).toBeNull();
  });

  it('stores every manual song as its own entry', async () => {
    const a = await storage.songs.upsert({ source: 'manual', title: 'Mi canción', externalId: 'ignored' });
    const b = await storage.songs.upsert({ source: 'manual', title: 'Mi canción' });
    expect(a.externalId).toBeNull();
    expect(a.id).not.toBe(b.id);
    expect(a.artist).toBe('');
  });

  it('lists newest first and gets by id', async () => {
    const old = await storage.songs.upsert({ source: 'manual', title: 'Old', addedAt: 1 });
    const recent = await storage.songs.upsert({ source: 'manual', title: 'New', addedAt: 2 });
    expect((await storage.songs.list()).map((s) => s.id)).toEqual([recent.id, old.id]);
    expect(await storage.songs.get(old.id)).toEqual(old);
    expect(await storage.songs.list(1)).toHaveLength(1);
  });

  it('removes a song with its lyrics', async () => {
    const song = await storage.songs.upsert({ source: 'manual', title: 'Con letra' });
    await storage.lyrics.put(song.id, 'Dale, mami', { lines: ['Dale, mami'] });
    await storage.songs.remove(song.id);
    expect(await storage.songs.get(song.id)).toBeNull();
    expect(await storage.lyrics.get(song.id)).toBeNull();
  });

  it('rejects unknown sources and service songs without an id', async () => {
    await expect(storage.songs.upsert({ source: 'tidal' as 'manual', title: 'x' })).rejects.toThrow(/source/);
    await expect(storage.songs.upsert({ source: 'spotify_share', externalId: ' ', title: 'x' })).rejects.toThrow(/external id/);
  });
});
