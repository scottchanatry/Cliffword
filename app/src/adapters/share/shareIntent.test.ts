import appJson from '../../../app.json';
import { parseSpotifyShare } from './parseSpotifyShare';
import { SHARE_EXTENSION_KEY, SHARE_ROUTE, SHARE_SCHEME, shareIntentToInput, shareRouteFor } from './shareIntent';

// The package's own parser of native payloads (the package itself is mocked in Jest).
const { parseShareIntent } = jest.requireActual<typeof import('expo-share-intent/build/utils')>('expo-share-intent/build/utils');

const ID = '4uLU6hMCjMI75M1A2tKUQC';
const TRACK = `https://open.spotify.com/track/${ID}?si=a1b2c3`;

describe('share-extension deep links', () => {
  it('uses the app scheme and sends extension links to the Music tab', () => {
    expect(SHARE_SCHEME).toBe(appJson.expo.scheme);
    expect(SHARE_EXTENSION_KEY).toBe('cliffwordShareKey');
    expect(shareRouteFor('cliffword://dataUrl=cliffwordShareKey?nonce=0B5E#weburl')).toBe(SHARE_ROUTE);
    expect(shareRouteFor('cliffword://dataUrl=cliffwordShareKey#text')).toBe('/music');
    expect(shareRouteFor('cliffword://music')).toBeNull();
    expect(shareRouteFor('/profile')).toBeNull();
    expect(shareRouteFor('otherapp://dataUrl=otherappShareKey#text')).toBeNull();
  });
});

describe('shareIntentToInput', () => {
  const read = (value: unknown) => shareIntentToInput(parseShareIntent(value as never, {}));

  it('reads an iOS link share (the extension stores weburls)', () => {
    const payload = JSON.stringify({ weburls: [{ url: TRACK, meta: '{"title":"Despacito"}' }], type: 'weburl' });
    const input = read(payload);
    expect(input).toEqual({ url: TRACK });
    expect(parseSpotifyShare(input ?? {})).toEqual({ trackId: ID });
  });

  it('reads an iOS text share ("Song - Artist")', () => {
    const input = read(JSON.stringify({ text: 'Despacito - Luis Fonsi', type: 'text' }));
    expect(input).toEqual({ text: 'Despacito - Luis Fonsi' });
    expect(parseSpotifyShare(input ?? {})).toEqual({ title: 'Despacito', artist: 'Luis Fonsi' });
  });

  it('reads an Android Spotify share (EXTRA_TEXT is the link)', () => {
    const input = read({ text: TRACK, type: 'text', meta: { title: null } });
    expect(input).toEqual({ url: TRACK });
    expect(parseSpotifyShare(input ?? {})).toEqual({ trackId: ID });
  });

  it('keeps text around a link, so the title and artist are read too', () => {
    const text = `Ella y Yo - Aventura ${TRACK}`;
    const input = read({ text, type: 'text' });
    expect(input).toEqual({ url: TRACK, text });
    expect(parseSpotifyShare(input ?? {})).toEqual({ trackId: ID, title: 'Ella y Yo', artist: 'Aventura' });
  });

  it('reads a spotify: URI from text (no web link)', () => {
    expect(read({ text: `spotify:track:${ID}`, type: 'text' })).toEqual({ text: `spotify:track:${ID}` });
  });

  it('ignores file shares and empty payloads', () => {
    expect(read({ files: [{ contentUri: 'content://x', mimeType: 'audio/mpeg', fileName: 'a.mp3', filePath: '/a.mp3' }], type: 'file' })).toBeNull();
    expect(shareIntentToInput({ text: '   ', webUrl: null })).toBeNull();
    expect(shareIntentToInput({})).toBeNull();
  });
});
