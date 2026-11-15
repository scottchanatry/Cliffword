/**
 * Web twin of createNativeMusicPlayer.ts: there is no Apple Music on the web, and Metro picks
 * this file for the web bundle, so modules/cliffword-music never reaches it.
 */
import type { Clock } from '../clock/types';
import type { MusicPlayer } from './types';
import { UnsupportedMusicPlayer } from './UnsupportedMusicPlayer';

export function createNativeMusicPlayer(_platform: 'ios' | 'android', _clock?: Clock): MusicPlayer {
  return new UnsupportedMusicPlayer();
}
