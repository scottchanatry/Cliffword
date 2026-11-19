/**
 * The Story tab in library mode (the session plays an experience): the Story home, the episode
 * screen or the experience picker, and the first-episode guide.
 *
 * - vm.view 'home' (nothing plays) or 'episode' (StoryActions.openEpisode / closeEpisode).
 * - "Change experience" opens the picker over the home; a pick goes to onPickExperience (the
 *   route stores settings.trackId and trackChoices; the controller follows the settings).
 * - The guide: three coach marks on the first episode (listen, then answer when the gap shows,
 *   then feedback on the first answer), "Skip the tips" ends it; onGuideDone stores that it was
 *   seen (settings.guideSeen), so it shows once.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StoryActions, StoryViewModel } from '../../../session/contract';
import { colors } from '../../../theme';
import { GUIDE_TIPS, type GuideTip } from './CoachMark';
import { EpisodeView } from './EpisodeView';
import { ExperiencePicker } from './ExperiencePicker';
import { StoryHomeView, type ModelLine } from './StoryHomeView';

export interface LibraryStoryOptions {
  /** Store a picked experience and its choices (settings). */
  onPickExperience?: (trackId: string, choices: Record<string, string>) => void;
  /** settings.guideSeen: the first-episode guide was shown. */
  guideSeen?: boolean;
  onGuideDone?: () => void;
  /** The language model's line on the home. */
  model?: ModelLine;
}

export interface LibraryStoryProps extends LibraryStoryOptions {
  vm: StoryViewModel;
  actions: StoryActions;
}

export function LibraryStory({ vm, actions, onPickExperience, guideSeen = true, onGuideDone, model }: LibraryStoryProps) {
  const [picker, setPicker] = useState(false);
  const [tip, setTip] = useState<GuideTip | null>(guideSeen ? null : 'listen');
  const screen = vm.screen;
  const lib = screen?.meta.library;
  const firstEpisode = lib !== undefined && lib.episode === 1 && !lib.replay;
  let shown: GuideTip | null = null;
  if (tip && firstEpisode && vm.view === 'episode' && !picker) {
    if (tip === 'listen' && screen?.kind === 'cliff') shown = 'listen';
    else if (tip === 'answer' && screen?.kind === 'cliff' && screen.phase !== 'playing') shown = 'answer';
    else if (tip === 'feedback' && screen?.kind === 'landing') shown = 'feedback';
  }
  const finishGuide = () => {
    setTip(null);
    onGuideDone?.();
  };
  const nextTip = () => {
    const i = tip ? GUIDE_TIPS.indexOf(tip) : -1;
    const following = GUIDE_TIPS[i + 1] ?? null;
    if (following) setTip(following);
    else finishGuide();
  };

  if (picker && onPickExperience) {
    return (
      <View style={styles.root}>
        <ExperiencePicker
          library={vm.library ?? null}
          busy={vm.busy}
          onClose={() => setPicker(false)}
          onPick={(trackId, choices) => {
            setPicker(false);
            onPickExperience(trackId, choices);
          }}
        />
      </View>
    );
  }
  if (vm.view === 'episode') {
    return (
      <EpisodeView
        vm={vm}
        actions={actions}
        guide={shown}
        onGuideNext={nextTip}
        onGuideSkip={finishGuide}
        {...(onPickExperience
          ? {
              onPickExperience: () => {
                actions.closeEpisode();
                setPicker(true);
              },
            }
          : {})}
      />
    );
  }
  return (
    <View style={styles.root}>
      <StoryHomeView vm={vm} actions={actions} onChangeExperience={() => setPicker(true)} {...(model ? { model } : {})} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
});
