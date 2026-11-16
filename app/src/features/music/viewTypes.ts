import type { LyricScreen } from '@cliffword/engine';
import type { LyricActions, LyricViewModel } from '../../session/contract';
import type { SongPageNav } from './types';

/** The props every song-screen kind view gets from SongView: its narrowed screen, the view model and the actions. */
export interface LyricKindProps<K extends LyricScreen['kind']> {
  screen: Extract<LyricScreen, { kind: K }>;
  vm: LyricViewModel;
  actions: LyricActions;
  nav?: SongPageNav;
  /** Start or stop listening without holding (screen readers). */
  toggleListen: () => void;
  /** Open the "Type instead" sheet. */
  openTyping: () => void;
}
