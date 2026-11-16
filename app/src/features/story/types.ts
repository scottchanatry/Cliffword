import type { StoryScreen } from '@cliffword/engine';
import type { StoryActions, StoryViewModel } from '../../session/contract';

/** The props every screen-kind view gets: its narrowed screen, the view model and the actions. */
export interface KindViewProps<K extends StoryScreen['kind']> {
  screen: Extract<StoryScreen, { kind: K }>;
  vm: StoryViewModel;
  actions: StoryActions;
  /** Start or stop listening without holding (screen readers). */
  toggleListen: () => void;
  /** Open the "Type instead" sheet. */
  openTyping: () => void;
}
