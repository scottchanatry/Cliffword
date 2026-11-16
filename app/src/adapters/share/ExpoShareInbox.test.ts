import { FakeClock } from '../clock/FakeClock';
import { openTestStorage } from '../../storage/testing/openTestStorage';
import { createNativeShareInbox } from './createNativeShareInbox';
import { ExpoShareInbox, type ShareInboxStore } from './ExpoShareInbox';
import { parseSpotifyShare } from './parseSpotifyShare';
import type { SharedItem } from './types';

const ID = '4uLU6hMCjMI75M1A2tKUQC';
const TRACK = `https://open.spotify.com/track/${ID}`;

type TestStorage = Awaited<ReturnType<typeof openTestStorage>>;

let storage: TestStorage;
let clock: FakeClock;

beforeEach(async () => {
  storage = await openTestStorage();
  clock = new FakeClock();
});
afterEach(() => storage.close());

const inboxOver = (store: ShareInboxStore = storage.shareInbox, log = jest.fn()) => {
  const inbox = new ExpoShareInbox(() => Promise.resolve(store), clock, log);
  const seen: SharedItem[] = [];
  inbox.onShare((item) => seen.push(item));
  return { inbox, seen, log };
};

describe('ExpoShareInbox', () => {
  it('stores each item in share_inbox before it shows up, and parses with parseSpotifyShare', async () => {
    const { inbox, seen } = inboxOver();
    const link = await inbox.receive({ url: ` ${TRACK} ` });
    clock.advance(500);
    const text = await inbox.receive({ text: 'Despacito - Luis Fonsi' });

    const rows = await storage.shareInbox.pending();
    expect(rows.map((r) => ({ id: String(r.id), url: r.url, text: r.text }))).toEqual([
      { id: link?.id, url: TRACK, text: null },
      { id: text?.id, url: null, text: 'Despacito - Luis Fonsi' },
    ]);
    expect(link).toEqual({ id: '1', url: TRACK, receivedAt: clock.now() - 500 });
    expect(inbox.pending()).toEqual([link, text]);
    expect(seen).toEqual([link, text]);
    expect(inbox.pending().map(parseSpotifyShare)).toEqual([{ trackId: ID }, { title: 'Despacito', artist: 'Luis Fonsi' }]);
  });

  it('stores and announces a repeated delivery once, even when both arrive together', async () => {
    const { inbox, seen } = inboxOver();
    const [a, b] = await Promise.all([inbox.receive({ url: TRACK }), inbox.receive({ url: TRACK, text: '' })]);
    const c = await inbox.receive({ url: TRACK });
    expect(a).toEqual(b);
    expect(c).toEqual(a);
    expect(seen).toHaveLength(1);
    expect(inbox.pending()).toHaveLength(1);
    expect(await storage.shareInbox.pending()).toHaveLength(1);
  });

  it('ignores blank shares', async () => {
    const { inbox, seen } = inboxOver();
    expect(await inbox.receive({})).toBeNull();
    expect(await inbox.receive({ url: '  ', text: '\n' })).toBeNull();
    expect(seen).toEqual([]);
    expect(await storage.shareInbox.pending()).toEqual([]);
  });

  it('restores unhandled items in the next run, oldest first, and leaves cleared ones out', async () => {
    const first = inboxOver().inbox;
    const kept = await first.receive({ text: 'Ella y Yo - Aventura' });
    clock.advance(1_000);
    const handled = await first.receive({ url: TRACK });
    first.clear(handled?.id ?? '');
    expect(first.pending()).toEqual([kept]);
    // markHandled runs after clear() returns; a write queued behind it waits for it.
    await storage.shareInbox.get(1);

    const { inbox: next, seen } = inboxOver();
    expect(next.pending()).toEqual([]);
    clock.advance(1_000);
    const fresh = await next.receive({ text: 'Tití Me Preguntó - Bad Bunny' });
    await next.restore();
    await next.restore();
    expect(next.pending()).toEqual([kept, fresh]);
    expect(seen).toEqual([fresh, kept]);

    // A new share of the handled song is a new item.
    const again = await next.receive({ url: TRACK });
    expect(again?.id).not.toBe(handled?.id);
  });

  it('does not bring back an item cleared while a restore was reading', async () => {
    const { inbox: first } = inboxOver();
    const item = await first.receive({ text: 'a - b' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let readDone: () => void = () => undefined;
    const read = new Promise<void>((resolve) => {
      readDone = resolve;
    });
    const slowStore: ShareInboxStore = {
      add: (input) => storage.shareInbox.add(input),
      markHandled: (id) => storage.shareInbox.markHandled(id),
      pending: async () => {
        const rows = await storage.shareInbox.pending();
        readDone();
        await gate;
        return rows;
      },
    };
    const { inbox: next } = inboxOver(slowStore);
    const restoring = next.restore();
    await read;
    next.clear(item?.id ?? '');
    release();
    await restoring;
    expect(next.pending()).toEqual([]);
  });

  it('keeps an item for this run when storage fails, logs it, and lets restore retry', async () => {
    const broken: ShareInboxStore = {
      add: () => Promise.reject(new Error('disk full')),
      pending: () => Promise.reject(new Error('locked')),
      markHandled: () => Promise.reject(new Error('locked')),
    };
    const { inbox, seen, log } = inboxOver(broken);
    const item = await inbox.receive({ text: 'Corazón Lento - María Demo' });
    expect(item).toEqual({ id: 'mem-1', receivedAt: clock.now(), text: 'Corazón Lento - María Demo' });
    expect(await inbox.receive({ text: 'Corazón Lento - María Demo' })).toBe(item);
    expect(seen).toEqual([item]);
    expect(log).toHaveBeenCalledTimes(2);
    inbox.clear('mem-1');
    expect(inbox.pending()).toEqual([]);
    await expect(inbox.restore()).rejects.toThrow('locked');

    // The same inbox recovers once storage opens.
    let opens = 0;
    const flaky = new ExpoShareInbox(
      () => (++opens === 1 ? Promise.reject(new Error('not yet')) : Promise.resolve(storage.shareInbox)),
      clock,
      jest.fn(),
    );
    await storage.shareInbox.add({ text: 'left - over' });
    await expect(flaky.restore()).rejects.toThrow('not yet');
    await flaky.restore();
    expect(flaky.pending().map((i) => i.text)).toEqual(['left - over']);
  });

  it('logs a failed markHandled without throwing', async () => {
    const store: ShareInboxStore = {
      add: (input) => storage.shareInbox.add(input),
      pending: () => storage.shareInbox.pending(),
      markHandled: () => Promise.reject(new Error('read-only')),
    };
    const { inbox, log } = inboxOver(store);
    const item = await inbox.receive({ text: 'x - y' });
    expect(() => inbox.clear(item?.id ?? '')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('handled'), expect.any(Error));
  });
});

describe('createNativeShareInbox', () => {
  it('builds an ExpoShareInbox over the storage service', async () => {
    const open = jest.fn(() => Promise.resolve(storage));
    const inbox = createNativeShareInbox({ open }, clock);
    expect(inbox).toBeInstanceOf(ExpoShareInbox);
    expect(open).not.toHaveBeenCalled();
    await (inbox as ExpoShareInbox).receive({ url: TRACK });
    expect(open).toHaveBeenCalledTimes(1);
    expect(await storage.shareInbox.pending()).toHaveLength(1);
  });
});
