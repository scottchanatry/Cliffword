import { parseSongArtist, parseSpotifyShare } from './parseSpotifyShare';

const ID = '4uLU6hMCjMI75M1A2tKUQC';

describe('parseSpotifyShare: track links', () => {
  it.each([
    `https://open.spotify.com/track/${ID}`,
    `https://open.spotify.com/track/${ID}?si=a1b2c3d4e5f6`,
    `https://open.spotify.com/intl-es/track/${ID}?si=x`,
    `https://open.spotify.com/intl-pt-BR/track/${ID}`,
    `https://open.spotify.com/embed/track/${ID}`,
    `http://play.spotify.com/track/${ID}/`,
    `https://OPEN.spotify.com/track/${ID}#t=30`,
    `spotify:track:${ID}`,
  ])('reads the track id from %s', (url) => {
    expect(parseSpotifyShare({ url })).toEqual({ trackId: ID });
  });

  it('finds the link inside shared text and reads "Song - Artist" around it', () => {
    expect(parseSpotifyShare({ text: `Despacito - Luis Fonsi https://open.spotify.com/track/${ID}?si=abc` })).toEqual({
      trackId: ID,
      title: 'Despacito',
      artist: 'Luis Fonsi',
    });
    expect(parseSpotifyShare({ text: `Escucha esto: https://open.spotify.com/track/${ID}.` })).toEqual({ trackId: ID });
  });

  it('combines a url with title and artist from the text', () => {
    expect(
      parseSpotifyShare({ url: `https://open.spotify.com/track/${ID}`, text: '“Callaíta” by Bad Bunny' }),
    ).toEqual({ trackId: ID, title: 'Callaíta', artist: 'Bad Bunny' });
  });

  it('rejects ids that are not 22 base-62 characters', () => {
    expect(parseSpotifyShare({ url: 'https://open.spotify.com/track/short' })).toBeNull();
    expect(parseSpotifyShare({ url: `https://open.spotify.com/track/${ID}X` })).toBeNull();
    expect(parseSpotifyShare({ url: `spotify:track:${ID.slice(1)}-` })).toBeNull();
  });

  it('returns null for Spotify links that are not tracks, whatever the text says', () => {
    expect(parseSpotifyShare({ url: `https://open.spotify.com/album/${ID}` })).toBeNull();
    expect(parseSpotifyShare({ url: `https://open.spotify.com/playlist/${ID}`, text: 'Éxitos - Spotify' })).toBeNull();
    expect(parseSpotifyShare({ text: `spotify:artist:${ID}` })).toBeNull();
  });

  it('reads only the text of short links and other sites', () => {
    expect(parseSpotifyShare({ url: 'https://spotify.link/AbCdEf', text: 'Tití Me Preguntó - Bad Bunny' })).toEqual({
      title: 'Tití Me Preguntó',
      artist: 'Bad Bunny',
    });
    expect(parseSpotifyShare({ url: 'https://example.com/x' })).toBeNull();
  });
});

describe('parseSpotifyShare: text only', () => {
  it.each([
    ['Despacito - Luis Fonsi', 'Despacito', 'Luis Fonsi'],
    ['Despacito – Luis Fonsi', 'Despacito', 'Luis Fonsi'],
    ['Despacito — Luis Fonsi', 'Despacito', 'Luis Fonsi'],
    ['  Despacito   -   Luis Fonsi \n', 'Despacito', 'Luis Fonsi'],
    ['Despacito - Remix - Luis Fonsi', 'Despacito - Remix', 'Luis Fonsi'],
    ['"Despacito - Luis Fonsi"', 'Despacito', 'Luis Fonsi'],
    ['"Ella y Yo" by Aventura', 'Ella y Yo', 'Aventura'],
    ['‘Pa’ Ti’ by Jennifer Lopez', 'Pa’ Ti', 'Jennifer Lopez'],
    ["Pa' Ti - Jennifer Lopez", "Pa' Ti", 'Jennifer Lopez'],
    ["'Tá Bueno - El Corillo", "'Tá Bueno", 'El Corillo'],
    ['Me Porto Bonito - Bad Bunny, Chencho Corleone', 'Me Porto Bonito', 'Bad Bunny, Chencho Corleone'],
  ])('reads %j', (text, title, artist) => {
    expect(parseSpotifyShare({ text })).toEqual({ title, artist });
  });

  it.each([[''], ['   '], ['Despacito'], ['Luis-Fonsi'], ['Despacito - '], [' - Luis Fonsi'], ['a-b - ']])(
    'returns null for %j',
    (text) => {
      expect(parseSpotifyShare({ text })).toBeNull();
    },
  );

  it('returns null for an empty item', () => {
    expect(parseSpotifyShare({})).toBeNull();
  });

  it('parseSongArtist ignores links', () => {
    expect(parseSongArtist(`Ojitos Lindos - Bad Bunny https://open.spotify.com/track/${ID}`)).toEqual({
      title: 'Ojitos Lindos',
      artist: 'Bad Bunny',
    });
  });
});
