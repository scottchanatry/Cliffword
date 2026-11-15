/**
 * Reads a Spotify track out of a shared item (pure).
 *
 * - Track links: https://open.spotify.com/track/<id> (also /intl-xx/track/, /embed/track/,
 *   play.spotify.com, any query or fragment) and spotify:track:<id> URIs, in the item's url or
 *   anywhere in its text. A track id is 22 base-62 characters.
 * - Text: "Song - Artist" (hyphen, en dash or em dash with spaces around it; the last one
 *   splits, since titles carry " - Live" or " - Remastered" more often than artists do) and
 *   '"Song" by Artist' (straight or curly quotes). Links are removed from the text first.
 *
 * A Spotify link that is not a track (album, playlist, artist, episode) means the share is not
 * a song: the result is null even if the text looks like "Name - Artist". Short links
 * (spotify.link) cannot be resolved offline, so only their text is read.
 */

export interface SpotifyShare {
  /** The Spotify track id, when the share carried a track link. */
  trackId?: string;
  title?: string;
  artist?: string;
}

const TRACK_URL_RE =
  /^https?:\/\/(?:open|play)\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2,4})?\/)?(?:embed\/)?track\/([A-Za-z0-9]{22})(?=$|[/?#])/i;
const TRACK_URI_RE = /^spotify:track:([A-Za-z0-9]{22})$/;
const SPOTIFY_URL_RE = /^https?:\/\/(?:open|play)\.spotify\.com\//i;
const SPOTIFY_URI_RE = /^spotify:[a-z]+:/i;
const LINK_RE = /(?:https?:\/\/|spotify:)\S+/gi;

// Straight single quotes are left alone: clipped forms ('tá, pa') start or end with them.
const QUOTED_BY_RE = /^["“‘](.+?)["”’]\s+by\s+(.+)$/i;
const SURROUNDING_QUOTES_RE = /^(?:"([^"]+)"|“([^“”]+)”|‘([^‘’]+)’)$/;
const DASH_RE = /\s+[-–—]\s+/g;

type LinkKind = { kind: 'track'; trackId: string } | { kind: 'other-spotify' } | { kind: 'other' };

function classifyLink(raw: string): LinkKind {
  // Trailing punctuation from prose ("…on Spotify: https://…/track/x.") is not part of a link.
  const link = raw.trim().replace(/[).,;:!?»”"']+$/, '');
  const match = TRACK_URL_RE.exec(link) ?? TRACK_URI_RE.exec(link);
  if (match?.[1]) return { kind: 'track', trackId: match[1] };
  if (SPOTIFY_URL_RE.test(link) || SPOTIFY_URI_RE.test(link)) return { kind: 'other-spotify' };
  return { kind: 'other' };
}

/** Collapses spaces and removes one pair of surrounding double or curly quotes. */
function clean(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  const m = SURROUNDING_QUOTES_RE.exec(t);
  return (m ? (m[1] ?? m[2] ?? m[3] ?? '') : t).trim();
}

/** Title and artist from share text without links, or null. */
export function parseSongArtist(text: string): { title: string; artist: string } | null {
  const body = clean(text.replace(LINK_RE, ' ')).replace(/[\s:–—-]+$/, '');
  if (!body) return null;

  const quoted = QUOTED_BY_RE.exec(body);
  if (quoted?.[1] && quoted[2]) {
    const title = clean(quoted[1]);
    const artist = clean(quoted[2]);
    return title && artist ? { title, artist } : null;
  }

  const dashes = [...body.matchAll(DASH_RE)];
  const last = dashes[dashes.length - 1];
  if (!last || last.index === undefined) return null;
  const title = clean(body.slice(0, last.index));
  const artist = clean(body.slice(last.index + last[0].length));
  return title && artist ? { title, artist } : null;
}

export function parseSpotifyShare(item: { url?: string; text?: string }): SpotifyShare | null {
  const text = item.text ?? '';
  const links = [...(item.url ? [item.url] : []), ...(text.match(LINK_RE) ?? [])].map(classifyLink);

  const track = links.find((l): l is Extract<LinkKind, { kind: 'track' }> => l.kind === 'track');
  if (!track && links.some((l) => l.kind === 'other-spotify')) return null;

  const names = parseSongArtist(text);
  if (!track && !names) return null;
  return {
    ...(track ? { trackId: track.trackId } : {}),
    ...(names ?? {}),
  };
}
