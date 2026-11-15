import { openTestStorage } from '../testing/openTestStorage';

interface StorySnapshot {
  storyId: string;
  sentence: number;
  pending: { cliff: string } | null;
}

describe('SessionRepo', () => {
  let storage: Awaited<ReturnType<typeof openTestStorage>>;
  beforeEach(async () => {
    storage = await openTestStorage();
  });
  afterEach(() => storage.close());

  it('saves a session and reads it back with its snapshot', async () => {
    const saved = await storage.sessions.save<StorySnapshot>({
      kind: 'story',
      version: 1,
      snapshot: { storyId: 's1', sentence: 3, pending: { cliff: 'mercado' } },
    });
    expect(saved).toMatchObject({ id: 'id-1', kind: 'story', active: true, updatedAt: storage.clock.now() });
    expect(await storage.sessions.get<StorySnapshot>(saved.id)).toEqual(saved);
    expect(await storage.sessions.get('nope')).toBeNull();
  });

  it('updates a session in place', async () => {
    const first = await storage.sessions.save({ kind: 'lyric', version: 1, snapshot: { line: 1 } });
    storage.clock.advance(5000);
    await storage.sessions.save({ id: first.id, kind: 'lyric', version: 2, snapshot: { line: 2 } });
    const again = await storage.sessions.get(first.id);
    expect(again).toMatchObject({ version: 2, snapshot: { line: 2 }, updatedAt: first.updatedAt + 5000 });
    expect(await storage.sessions.list()).toHaveLength(1);
  });

  it('keeps one active session per kind', async () => {
    const a = await storage.sessions.save({ kind: 'story', version: 1, snapshot: 'a' });
    const lyric = await storage.sessions.save({ kind: 'lyric', version: 1, snapshot: 'l' });
    storage.clock.advance(1);
    const b = await storage.sessions.save({ kind: 'story', version: 1, snapshot: 'b' });
    expect((await storage.sessions.active('story'))?.id).toBe(b.id);
    expect((await storage.sessions.get(a.id))?.active).toBe(false);
    expect((await storage.sessions.active('lyric'))?.id).toBe(lyric.id);
    expect(await storage.sessions.active('retell')).toBeNull();
  });

  it('saves an inactive session without touching the active one', async () => {
    const active = await storage.sessions.save({ kind: 'retell', version: 1, snapshot: 1 });
    await storage.sessions.save({ kind: 'retell', version: 1, snapshot: 2, active: false });
    expect((await storage.sessions.active('retell'))?.id).toBe(active.id);
  });

  it('lists the most recent first, optionally by kind', async () => {
    await storage.sessions.save({ kind: 'story', version: 1, snapshot: 1, updatedAt: 10 });
    await storage.sessions.save({ kind: 'lyric', version: 1, snapshot: 2, updatedAt: 30 });
    await storage.sessions.save({ kind: 'story', version: 1, snapshot: 3, updatedAt: 20, active: false });
    expect((await storage.sessions.list()).map((s) => s.updatedAt)).toEqual([30, 20, 10]);
    expect((await storage.sessions.list({ kind: 'story' })).map((s) => s.snapshot)).toEqual([3, 1]);
    expect(await storage.sessions.list({ limit: 1 })).toHaveLength(1);
  });

  it('deactivates and removes sessions', async () => {
    const s = await storage.sessions.save({ kind: 'story', version: 1, snapshot: {} });
    await storage.sessions.deactivate(s.id);
    expect(await storage.sessions.active('story')).toBeNull();
    await storage.sessions.remove(s.id);
    expect(await storage.sessions.get(s.id)).toBeNull();
  });

  it('rejects unknown kinds and non-integer versions', async () => {
    await expect(storage.sessions.save({ kind: 'karaoke' as 'story', version: 1, snapshot: 0 })).rejects.toThrow(/kind/);
    await expect(storage.sessions.save({ kind: 'story', version: 1.5, snapshot: 0 })).rejects.toThrow(/version/);
  });
});
