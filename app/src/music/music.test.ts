import type { LanguagePack, Segment } from '@cliffword/engine';
import { defaultPacks } from '../services/defaults';
import { openTestStorage } from '../storage/testing/openTestStorage';
import { MemoryShareInbox } from '../adapters/share/MemoryShareInbox';
import { FakeClock } from '../adapters/clock/FakeClock';
import { hasLyricLines, lyricsPreview, parsePastedLyrics, readLyrics, saveLyrics } from './lyricsData';
import { pendingShareRows, saveSharedSong, shareDraft } from './share';
import { monogram, slangAmount, songSummary } from './songSummary';

const { lang, pair } = defaultPacks();

/** A segmenter for a script without spaces: each listed word is a segment (never split on spaces). */
const WORDS = ['私', 'は', '学生', 'です'];
const noSpace: Pick<LanguagePack, 'segment'> = {
  segment(text: string): Segment[] {
    const out: Segment[] = [];
    let i = 0;
    while (i < text.length) {
      const w = WORDS.find((x) => text.startsWith(x, i)) ?? (text[i] as string);
      out.push({ text: w, norm: w, start: i, end: i + w.length, kind: WORDS.includes(w) ? 'word' : 'punct' });
      i += w.length;
    }
    return out;
  },
};

const LUNA = `[Coro]
Esta noche salimos a janguear,
el corillo ya 'tá listo pa' janguear.
La calle 'tá brutal, coño, qué calor.`;

const NEUTRAL = `Tomo café sin azúcar por la mañana,
leo el periódico y miro la ventana.
Después camino despacio hasta el trabajo,
y saludo a la vecina que vive abajo.`;

describe('pasted lyrics', () => {
  it('parses plain text and LRC, and previews counts, slang and explicit words', () => {
    const plain = parsePastedLyrics(LUNA, lang);
    expect(plain.lines.map((l) => l.text)).toEqual([
      'Esta noche salimos a janguear,',
      "el corillo ya 'tá listo pa' janguear.",
      "La calle 'tá brutal, coño, qué calor.",
    ]);
    expect(hasLyricLines(plain)).toBe(true);
    const preview = lyricsPreview(plain, lang, pair, { regions: ['PR', 'CARIB'], showExplicit: true });
    expect(preview).toMatchObject({ lines: 3, timedLines: 0, removed: 1, explicit: 1 });
    expect(preview.notes.map((n) => n.form)).toEqual(expect.arrayContaining(['janguear', 'corillo', 'coño']));
    expect(preview.firstLines[0]).toBe('Esta noche salimos a janguear,');
    const hidden = lyricsPreview(plain, lang, pair, { regions: ['PR', 'CARIB'], showExplicit: false });
    expect(hidden.notes.some((n) => n.explicit)).toBe(false);
    expect(hidden.explicit).toBe(1);

    const lrc = parsePastedLyrics('[ti:Luna]\n[00:10.00]Esta noche salimos a janguear,\n[00:14.00]el corillo ya está listo.', lang);
    expect(lrc.timed).toBe(true);
    expect(lyricsPreview(lrc, lang, pair, { regions: [], showExplicit: true })).toMatchObject({ lines: 2, timedLines: 2, removed: 0 });
    expect(hasLyricLines(parsePastedLyrics('[Coro]\n\n', lang))).toBe(false);
  });

  it('stores the raw text and reads it back parsed', async () => {
    const storage = await openTestStorage();
    const song = await storage.songs.upsert({ source: 'manual', title: 'Luna' });
    expect(await readLyrics(storage, song.id, lang)).toBeNull();
    await saveLyrics(storage, song.id, LUNA, lang, 5);
    const stored = await readLyrics(storage, song.id, lang);
    expect(stored).toMatchObject({ raw: LUNA, updatedAt: 5 });
    expect(stored?.lyrics.lines).toHaveLength(3);
    await storage.close();
  });
});

describe('song summary', () => {
  it('says where the slang is from and how much there is', () => {
    const luna = songSummary(parsePastedLyrics(LUNA, lang), lang, pair);
    expect(luna).toMatchObject({ region: 'PR', slang: 'lots', lines: 3, explicit: 1, timed: false });
    expect(luna.slangCount).toBeGreaterThanOrEqual(6);
    const carib = songSummary(parsePastedLyrics("Ya 'tá listo pa' la casa.", lang), lang, pair);
    expect(carib.region).toBe('CARIB');
    const neutral = songSummary(parsePastedLyrics(NEUTRAL, lang), lang, pair);
    expect(neutral).toMatchObject({ region: null, slang: 'none', slangCount: 0 });
  });

  it('grades the slang amount per sung word', () => {
    expect(slangAmount(0, 100)).toBe('none');
    expect(slangAmount(1, 100)).toBe('little');
    expect(slangAmount(3, 100)).toBe('some');
    expect(slangAmount(9, 100)).toBe('lots');
  });

  it('makes a monogram from the title words, without splitting on spaces', () => {
    expect(monogram('Luna de Santurce', lang)).toBe('LS');
    expect(monogram('Café sin azúcar', lang)).toBe('CS');
    expect(monogram('¡Dale!', lang)).toBe('D');
    expect(monogram('学生です', noSpace)).toBe('学');
  });
});

describe('shared songs', () => {
  it('drafts a song from a Spotify share, flags a non-song link, and saves it once per track', async () => {
    const inbox = new MemoryShareInbox(new FakeClock());
    const track = inbox.receive({ url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x', text: 'Luna de Santurce - Rayo K.' });
    const album = inbox.receive({ url: 'https://open.spotify.com/album/1A2GTWGtFfWp7KSQTwWOyo' });
    const text = inbox.receive({ text: '"Malecón a las dos" by Brisa 809' });
    expect(track && album && text).toBeTruthy();
    expect(shareDraft(track!)).toMatchObject({ title: 'Luna de Santurce', artist: 'Rayo K.', trackId: '4uLU6hMCjMI75M1A2tKUQC', notASong: false });
    expect(shareDraft(album!)).toMatchObject({ title: '', artist: '', trackId: null, notASong: true });
    expect(pendingShareRows(inbox.pending())).toEqual([
      { id: track!.id, title: 'Luna de Santurce', artist: 'Rayo K.' },
      { id: album!.id, title: null, artist: null },
      { id: text!.id, title: 'Malecón a las dos', artist: 'Brisa 809' },
    ]);

    const storage = await openTestStorage();
    const a = await saveSharedSong(storage, shareDraft(track!), { title: ' Luna de Santurce ', artist: 'Rayo K.' });
    expect(a).toMatchObject({ source: 'spotify_share', externalId: '4uLU6hMCjMI75M1A2tKUQC', title: 'Luna de Santurce' });
    const again = await saveSharedSong(storage, shareDraft(track!), { title: 'Luna de Santurce (Remix)', artist: 'Rayo K.' });
    expect(again.id).toBe(a.id);
    const manual = await saveSharedSong(storage, shareDraft(text!), { title: 'Malecón a las dos', artist: 'Brisa 809' });
    expect(manual).toMatchObject({ source: 'manual', externalId: null });
    await expect(saveSharedSong(storage, shareDraft(album!), { title: ' ', artist: '' })).rejects.toThrow(/title/);
    expect(await storage.songs.list()).toHaveLength(2);
    await storage.close();
  });
});
