/**
 * The service container: one plain object holding every device adapter, the storage handle, the
 * active packs and the clock. Screens read it through useServices(); tests build it with
 * createTestServices() (testServices.ts).
 */
import type { LanguagePack, PairPack } from '@cliffword/engine';
import type { Clock } from '../adapters/clock/types';
import type { Haptics } from '../adapters/haptics/types';
import type { ModelAdapter, ModelManager } from '../adapters/model/types';
import type { MusicPlayer } from '../adapters/music/types';
import type { ShareInbox } from '../adapters/share/types';
import type { SpeechIn } from '../adapters/speechIn/types';
import type { SpeechOut } from '../adapters/speechOut/types';
import type { StorageService } from './storageService';

export type { StorageService } from './storageService';

/** Which set of implementations a container holds: the app's platforms, or 'test' (createTestServices). */
export type ServicesPlatform = 'ios' | 'android' | 'web' | 'test';

/** The platforms createServices builds for. Tests use createTestServices (testServices.ts). */
export type AppPlatform = Exclude<ServicesPlatform, 'test'>;

/** The packs for the active pair (built by the engine's createDefaultSpanishPack / createDefaultPairPack). */
export interface ServicePacks {
  /** The target language pack (Spanish). */
  readonly lang: LanguagePack;
  /** The pair pack (English speakers learning Spanish). */
  readonly pair: PairPack;
}

export interface Services {
  readonly platform: ServicesPlatform;
  /** The language model the engine calls (LanguageModel plus load/unload/status). */
  readonly model: ModelAdapter;
  /** The model file: download, verify, delete. */
  readonly modelManager: ModelManager;
  readonly speechOut: SpeechOut;
  readonly speechIn: SpeechIn;
  /** Apple Music (MusicKit); UnsupportedMusicPlayer where it cannot run. */
  readonly music: MusicPlayer;
  /** Items shared in from other apps (Spotify links). */
  readonly share: ShareInbox;
  readonly haptics: Haptics;
  /** The app's database (settings, learner, sessions, songs, ...): open() once, then repositories. */
  readonly storage: StorageService;
  readonly packs: ServicePacks;
  readonly clock: Clock;
}

/** Services a factory may be given ready-made (a test swaps one adapter, the rest are built). */
export type ServiceOverrides = Partial<Omit<Services, 'platform'>>;
