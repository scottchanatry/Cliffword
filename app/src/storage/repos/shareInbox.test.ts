import { openTestStorage } from '../testing/openTestStorage';

const TRACK = 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh';

describe('ShareInboxRepo', () => {
  let storage: Awaited<ReturnType<typeof openTestStorage>>;
  beforeEach(async () => {
    storage = await openTestStorage();
  });
  afterEach(() => storage.close());

  it('queues shared links and text, oldest first', async () => {
    const link = await storage.shareInbox.add({ url: TRACK, text: 'Listen to this', receivedAt: 2 });
    const text = await storage.shareInbox.add({ text: '  Letra de la canción  ', receivedAt: 1 });
    expect(link).toEqual({ id: 1, receivedAt: 2, url: TRACK, text: 'Listen to this', handled: false });
    expect(text).toMatchObject({ url: null, text: 'Letra de la canción' });
    expect((await storage.shareInbox.pending()).map((i) => i.id)).toEqual([text.id, link.id]);
  });

  it('stores a repeated share once while it is unhandled', async () => {
    const a = await storage.shareInbox.add({ url: TRACK });
    const b = await storage.shareInbox.add({ url: TRACK, text: '' });
    expect(b.id).toBe(a.id);
    await storage.shareInbox.markHandled(a.id);
    const c = await storage.shareInbox.add({ url: TRACK });
    expect(c.id).not.toBe(a.id);
  });

  it('marks items handled and purges old handled ones', async () => {
    const old = await storage.shareInbox.add({ url: 'https://a.example', receivedAt: 10 });
    const recent = await storage.shareInbox.add({ url: 'https://b.example', receivedAt: 50 });
    const open = await storage.shareInbox.add({ url: 'https://c.example', receivedAt: 5 });
    await storage.shareInbox.markHandled(old.id);
    await storage.shareInbox.markHandled(recent.id);
    expect((await storage.shareInbox.get(old.id))?.handled).toBe(true);
    expect((await storage.shareInbox.pending()).map((i) => i.id)).toEqual([open.id]);
    expect(await storage.shareInbox.purgeHandled(20)).toBe(1);
    expect(await storage.shareInbox.get(old.id)).toBeNull();
    expect(await storage.shareInbox.get(recent.id)).not.toBeNull();
    expect(await storage.shareInbox.get(open.id)).not.toBeNull();
  });

  it('rejects an empty share', async () => {
    await expect(storage.shareInbox.add({ url: ' ', text: null })).rejects.toThrow(/URL or text/);
  });
});
