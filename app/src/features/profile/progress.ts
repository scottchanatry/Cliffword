/**
 * Settings' "your data" actions (src/storage/progress.ts): clearProgress and
 * deleteLyricsAndTexts. Reset progress runs through AppState.resetProgress, which stops the live
 * story and lyric sessions before it clears their data.
 */
export { PROGRESS_TABLES, clearProgress, deleteLyricsAndTexts } from '../../storage/progress';
