/**
 * The MusicPlayer for iOS and Android: MusicKitPlayer over the local module
 * modules/cliffword-music on iOS, UnsupportedMusicPlayer on Android (no Apple Music there in v1)
 * and on an iOS binary without the module.
 *
 * This file is the only importer of the module; its .web.ts twin keeps it out of the web bundle
 * (__tests__/importGraph.test.ts checks it). The module export is null where the binary lacks
 * it (and in Jest), so importing it never throws.
 */
import CliffwordMusic from '../../../modules/cliffword-music';
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { MusicKitPlayer, type MusicKitNative } from './MusicKitPlayer';
import type { MusicPlayer } from './types';
import { UnsupportedMusicPlayer } from './UnsupportedMusicPlayer';

export function createNativeMusicPlayer(
  platform: 'ios' | 'android',
  clock: Clock = systemClock,
  native: MusicKitNative | null = CliffwordMusic,
): MusicPlayer {
  if (platform !== 'ios' || !native) return new UnsupportedMusicPlayer();
  return new MusicKitPlayer(native, { clock });
}
