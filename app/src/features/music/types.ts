/**
 * Props of the Music tab's views (src/features/music), agreed between the routes in
 * app/(tabs)/music/* and app/text/* (which own the data: storage, services, settings) and the
 * views (which only draw and call back). Views never import storage, adapters or the engine
 * session classes.
 *
 * - Song screens (read A3, cliff C1, result, no sé, echo B4, registers C2, done) take the
 *   controller seam of src/session/contract.ts as it is: { vm: LyricViewModel; actions:
 *   LyricActions } (SongScreenProps below adds optional navigation only). The same props draw a
 *   brought text: vm.screen.meta.source is 'text' there.
 * - The library (C3), paste, share-confirm, time-it and brought-text paste screens take the
 *   plain props defined here.
 *
 * Every text in these props is data (titles, artists, lyrics, target-language text) or an i18n
 * key / UiText the view resolves with t(); none is interface text in the learner's language.
 *
 * The routes import these views (one named export per file in src/features/music/):
 *
 * | Route                         | View (file = name)    | Props               |
 * |-------------------------------|-----------------------|---------------------|
 * | (tabs)/music/index            | MusicLibraryView      | MusicLibraryProps   |
 * | (tabs)/music/[songId]         | SongView              | SongScreenProps     |
 * |   (song without lyrics)       | NeedsLyricsView       | NeedsLyricsProps    |
 * | (tabs)/music/registers        | SongView (registers)  | SongScreenProps     |
 * | (tabs)/music/paste            | PasteLyricsView       | PasteLyricsProps    |
 * | (tabs)/music/share            | ShareConfirmView      | ShareConfirmProps   |
 * | (tabs)/music/time             | TapTimerView          | TapTimerProps       |
 * | text/paste                    | TextPasteView         | TextPasteProps      |
 * | text/[textId]                 | SongView (source text)| SongScreenProps     |
 *
 * SongView switches on vm.screen?.kind (null: loading). The library keeps the testIDs the route
 * tests use: 'music-screen' on the screen, region pills as toggle buttons named by region,
 * and the explicit-lyrics button ('toggle-explicit').
 */
import type { SlangNote, UiText } from '@cliffword/engine';
import type { LyricActions, LyricViewModel, PlaybackState } from '../../session/contract';

// ---------------------------------------------------------------------------
// Song screens (controller-driven)
// ---------------------------------------------------------------------------

/** Navigation a song page may offer besides the controller's actions. All optional. */
export interface SongPageNav {
  /** Paste or edit the lyrics (music/paste?songId=). */
  onEditLyrics?: () => void;
  /** "Time it while you listen" (music/time?songId=): only offered when the song can play. */
  onTimeIt?: () => void;
  /** Two registers, side by side (music/registers?songId=). */
  onOpenRegisters?: () => void;
  /** Back to the library. */
  onBack?: () => void;
}

/** What every song screen view takes (A3, C1, result, no sé, native reply, B4, C2, done). */
export interface SongScreenProps {
  vm: LyricViewModel;
  actions: LyricActions;
  nav?: SongPageNav;
}

/** A song without lyrics yet (from a share or Apple Music): the page asks for them. */
export interface NeedsLyricsProps {
  title: string;
  artist: string;
  onPaste: () => void;
  onBack?: () => void;
}

// ---------------------------------------------------------------------------
// Library (C3)
// ---------------------------------------------------------------------------

/** How much slang a song has, for the library row ("lots of slang"). 'none' reads "neutral Spanish". */
export type SlangAmount = 'none' | 'little' | 'some' | 'lots';

/** What the library row says about a song's lyrics (songSummary). */
export interface SongSummary {
  /**
   * Region code where most of the song's slang is heard (PR, DO, CU, CO, or CARIB for slang
   * shared across the Caribbean), or null when the lyrics hold no slang (neutral).
   * Name it with t('region.<code>') (pair.ui) or t('region.pill.<code>') (app catalog).
   */
  region: string | null;
  slang: SlangAmount;
  /** Slang occurrences (repeats counted) and distinct slang lexemes. */
  slangCount: number;
  slangLexemes: number;
  /** Lyric lines (after parsing). */
  lines: number;
  /** Explicit slang occurrences. */
  explicit: number;
  /** The lyrics carry LRC times. */
  timed: boolean;
}

export type SongSourceKind = 'apple_music' | 'spotify_share' | 'manual';

/** A stored song in the library list. */
export interface LibrarySongRow {
  id: string;
  title: string;
  artist: string;
  /** One or two letters for the square (data, from the title: "LS" for "Luna de Santurce"). */
  monogram: string;
  source: SongSourceKind;
  hasLyrics: boolean;
  /** null until lyrics are pasted. */
  summary: SongSummary | null;
}

/** Apple Music state on this device. 'unsupported': Android and web (show the not-available text). */
export type AppleMusicStatus = 'checking' | 'unsupported' | 'notDetermined' | 'denied' | 'restricted' | 'authorized';

/** A song from the learner's Apple Music library that is not in the list yet. */
export interface AppleLibrarySong {
  /** The MusicKit id play() takes. */
  id: string;
  title: string;
  artist: string;
  explicit: boolean;
  genre: string | null;
}

/** A shared item waiting for the learner to confirm it as a song. */
export interface PendingShareRow {
  id: string;
  /** Parsed from the share; null when it could not be read. */
  title: string | null;
  artist: string | null;
}

/** A text the learner brought (article, transcript). */
export interface BroughtTextRow {
  id: string;
  title: string;
  /** Sentences (engine splitTextUnits). */
  sentences: number;
}

export interface MusicLibraryProps {
  /** Stored songs, most recently opened or added first. */
  songs: readonly LibrarySongRow[];
  appleMusic: AppleMusicStatus;
  /** Library songs not stored yet (authorized only); [] otherwise. */
  appleLibrary: readonly AppleLibrarySong[];
  /** Unconfirmed shares (Spotify links, "Song - Artist" texts). */
  shares: readonly PendingShareRow[];
  texts: readonly BroughtTextRow[];
  /** settings.regions; the pills show PR DO CU CO. */
  regions: readonly string[];
  /** settings.showExplicit (ON by default). */
  showExplicit: boolean;
  /** Storage or the library is still loading. */
  loading: boolean;
  /**
   * Optional: the platform the Apple Music row speaks for (default Platform.OS). The gallery's
   * c3-android fixture sets 'android', so a web preview shows the Android wording.
   */
  os?: string;
  onOpenSong: (id: string) => void;
  /** Add an Apple Music library song (stored, then its page asks for the lyrics). */
  onAddAppleSong: (id: string) => void;
  /** notDetermined: ask for access. */
  onConnectAppleMusic: () => void;
  /** authorized / denied / restricted: open the system settings. */
  onManageAppleMusic: () => void;
  /** Spotify "Show me": how to share a song from Spotify. */
  onShowSpotifyHowTo: () => void;
  /** Lyrics "Paste": a new song from pasted lyrics. */
  onPasteLyrics: () => void;
  onOpenShare: (id: string) => void;
  onBringText: () => void;
  onOpenText: (id: string) => void;
  onToggleRegion: (code: string) => void;
  onToggleExplicit: () => void;
}

// ---------------------------------------------------------------------------
// Paste lyrics (music/paste)
// ---------------------------------------------------------------------------

/** What the pasted text parses to, shown before saving. */
export interface LyricsPreview {
  lines: number;
  /** Lines with LRC times (the song can pause at lines on its own). */
  timedLines: number;
  /** Pasted lines left out (labels, site junk, timestamps-only), shown as a count. */
  removed: number;
  /** Slang notes of the song (explicit ones only when explicit lyrics are on). */
  notes: readonly SlangNote[];
  /** Explicit slang occurrences. */
  explicit: number;
  /** The first few lyric lines as parsed (data). */
  firstLines: readonly string[];
}

export interface PasteLyricsProps {
  title: string;
  artist: string;
  text: string;
  /** The song exists (shared or from Apple Music): title and artist are shown, not edited. */
  songFixed: boolean;
  /** null while the text is empty. */
  preview: LyricsPreview | null;
  canSave: boolean;
  saving: boolean;
  /** An i18n key to show (e.g. a save that failed), or null. */
  errorKey: string | null;
  onChangeTitle: (title: string) => void;
  onChangeArtist: (artist: string) => void;
  onChangeText: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Confirm a shared song (music/share)
// ---------------------------------------------------------------------------

export interface ShareConfirmProps {
  /** The shared link and text as they arrived (data); null when nothing is pending. */
  shared: { url: string | null; text: string | null } | null;
  title: string;
  artist: string;
  /** The share is a Spotify link to something other than a track (album, playlist). */
  notASong: boolean;
  canSave: boolean;
  saving: boolean;
  onChangeTitle: (title: string) => void;
  onChangeArtist: (artist: string) => void;
  /** Save the song, then ask for its lyrics. */
  onConfirm: () => void;
  /** Drop the share. */
  onDismiss: () => void;
}

// ---------------------------------------------------------------------------
// Time it while you listen (music/time)
// ---------------------------------------------------------------------------

export interface TapTimerLine {
  index: number;
  text: string;
  /** The tapped start, ms; null until tapped. */
  startMs: number | null;
}

export interface TapTimerProps {
  title: string;
  artist: string;
  lines: readonly TapTimerLine[];
  /** The line the next tap marks (lines.length when every line has a time). */
  current: number;
  playback: PlaybackState;
  onPlay: () => void;
  onPause: () => void;
  /** Mark the current line's start at the playback position. */
  onTap: () => void;
  /** Move a tapped start earlier or later (±250 ms). */
  onNudge: (index: number, deltaMs: number) => void;
  /** Forget the last tap. */
  onUndo: () => void;
  onDone: () => void;
}

// ---------------------------------------------------------------------------
// Brought text (text/paste)
// ---------------------------------------------------------------------------

export interface TextPreview {
  sentences: number;
  /** Slang notes found (explicit ones only when explicit lyrics are on). */
  slang: number;
}

export interface TextPasteProps {
  title: string;
  text: string;
  preview: TextPreview | null;
  /** The model is loaded: cliffs and surprise shading are scored. Otherwise the text opens in canned mode. */
  modelReady: boolean;
  canSave: boolean;
  saving: boolean;
  errorKey: string | null;
  onChangeTitle: (title: string) => void;
  onChangeText: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** Re-exported so views import their props from one place. */
export type { LyricActions, LyricViewModel, PlaybackState, UiText };
