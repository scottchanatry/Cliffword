/**
 * The two "your data" actions of Settings, each one transaction:
 *
 * - clearProgress: the learner model (event log and snapshots), every session (story, lyric and
 *   text sessions), the stories and their sentences, and minutes spoken. Settings, songs,
 *   lyrics, brought texts, the model file and its record stay.
 * - deleteLyricsAndTexts: every pasted lyric and brought text (on-device content), and the
 *   lyric and text sessions built on them. The songs stay, waiting for lyrics.
 *
 * Live session controllers write their state back when they stop, so a reset goes through
 * AppState.resetProgress (src/appState/AppStateProvider.tsx), which stops them first.
 */
import type { Storage } from './storage';

/** Tables clearProgress empties, in an order that never leaves a sentence without its story. */
export const PROGRESS_TABLES = ['learner_events', 'learner_snapshots', 'sessions', 'story_sentences', 'stories', 'spoken_time'] as const;

export async function clearProgress(storage: Pick<Storage, 'db'>): Promise<void> {
  await storage.db.transaction(async (tx) => {
    for (const table of PROGRESS_TABLES) await tx.run(`DELETE FROM ${table}`);
  });
}

/** Session kinds whose snapshots are built on lyrics or brought texts. */
const CONTENT_SESSION_KINDS = ['lyric'] as const;

export async function deleteLyricsAndTexts(storage: Pick<Storage, 'db'>): Promise<void> {
  await storage.db.transaction(async (tx) => {
    await tx.run('DELETE FROM lyrics');
    await tx.run('DELETE FROM texts');
    for (const kind of CONTENT_SESSION_KINDS) await tx.run('DELETE FROM sessions WHERE kind = ?', [kind]);
  });
}
