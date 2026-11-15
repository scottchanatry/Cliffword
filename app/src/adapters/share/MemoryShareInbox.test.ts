import { FakeClock } from '../clock/FakeClock';
import { MemoryShareInbox } from './MemoryShareInbox';
import { parseSpotifyShare } from './parseSpotifyShare';
import type { SharedItem } from './types';

describe('MemoryShareInbox', () => {
  it('keeps received items in order, notifies listeners and clears by id', () => {
    const clock = new FakeClock();
    const inbox = new MemoryShareInbox(clock);
    const seen: SharedItem[] = [];
    const off = inbox.onShare((item) => seen.push(item));

    const first = inbox.receive({ url: ' https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC ' });
    clock.advance(1000);
    const second = inbox.receive({ text: 'Despacito - Luis Fonsi', url: '' });

    expect(first).toEqual({ id: expect.any(String), url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', receivedAt: clock.now() - 1000 });
    expect(second).toEqual({ id: expect.any(String), text: 'Despacito - Luis Fonsi', receivedAt: clock.now() });
    expect(first?.id).not.toBe(second?.id);
    expect(inbox.pending()).toEqual([first, second]);
    expect(seen).toEqual([first, second]);
    expect(inbox.pending().map(parseSpotifyShare)).toEqual([
      { trackId: '4uLU6hMCjMI75M1A2tKUQC' },
      { title: 'Despacito', artist: 'Luis Fonsi' },
    ]);

    inbox.clear(first?.id ?? '');
    inbox.clear('unknown');
    expect(inbox.pending()).toEqual([second]);

    off();
    inbox.receive({ text: 'otra' });
    expect(seen).toHaveLength(2);
  });

  it('ignores blank shares', () => {
    const inbox = new MemoryShareInbox();
    const listener = jest.fn();
    inbox.onShare(listener);
    expect(inbox.receive({})).toBeNull();
    expect(inbox.receive({ url: '  ', text: '' })).toBeNull();
    expect(inbox.pending()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns a copy from pending()', () => {
    const inbox = new MemoryShareInbox();
    inbox.receive({ text: 'a - b' });
    inbox.pending().pop();
    expect(inbox.pending()).toHaveLength(1);
  });
});
