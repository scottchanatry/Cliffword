import { StyleSheet, View } from 'react-native';
import type { SentenceView } from '@cliffword/engine';
import { firstSense, GlossChip } from '../../components/words/GlossChip';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { TemplateText } from '../../components/words/TemplateText';
import { flowLook, WordFlow, type FlowLook } from '../../components/words/WordFlow';
import { useI18n } from '../../i18n';
import type { StoryViewModel } from '../../session/contract';
import { colors, spacing } from '../../theme';
import { Text } from '../../ui';
import { CliffCard } from './CliffCard';
import { HintRung, NativeAllowedChip, OptionsRung, rungLine } from './Rungs';
import { metaLine, MetaRow, TextModePill } from './StoryHeader';
import type { KindViewProps } from './types';
import { VoiceDock } from './VoiceDock';

/** Gloss chips shown at most under a sentence (a brand-new learner meets many new words at once). */
const MAX_GLOSS_CHIPS = 3;

/** The look of a screen: forced by the text mode, else by how much of the sentence is text. */
export function lookOf(vm: Pick<StoryViewModel, 'textMode'>, sentence: Parameters<typeof flowLook>[0]): FlowLook {
  if (vm.textMode === 'all_text') return 'ink';
  if (vm.textMode === 'all_tiles') return 'voice';
  return flowLook(sentence);
}

/**
 * The cliff: the story stops mid-sentence and the learner says what comes next. Mostly text
 * (Main): the passage, gloss chips for new words and the "Say what comes next" card. Mostly
 * tiles (B1): rows of tiles, the tile legend, the hold area and the command chips.
 */
export function CliffView({ screen, vm, actions, toggleListen, openTyping }: KindViewProps<'cliff'>) {
  const { t, plural } = useI18n();
  const look = lookOf(vm, screen.sentence);
  const { cliff, sentence } = screen;
  const glosses = passageGlosses(sentence, vm.previous).slice(0, MAX_GLOSS_CHIPS);
  return (
    <>
      <MetaRow canned={vm.modelMode === 'canned'}
        text={metaLine(t, screen.meta, vm.spokenTodayMs)}
        busy={vm.busy}
        right={<TextModePill mode={vm.textMode} mostlyText={look === 'ink'} onChange={actions.setTextMode} />}
      />
      <WordFlow
        sentence={sentence}
        previous={vm.previous}
        look={look}
        speakingWord={vm.speakingWord}
        onHear={actions.hearWord}
        onReveal={actions.revealWord}
      />
      {look === 'ink' ? (
        glosses.length > 0 ? (
          <View style={styles.glosses}>
            {glosses.map((g) => (
              <GlossChip key={g.index} word={g.word} gloss={g.gloss} testID={`gloss-${g.index}`} />
            ))}
          </View>
        ) : null
      ) : (
        <TileLegend example={glosses[0]} />
      )}
      <View style={styles.spacer} />
      {look === 'ink' ? (
        <CliffCard
          cliff={cliff}
          listen={vm.listen}
          onToggleListen={toggleListen}
          onTypeInstead={openTyping}
          onHearAgain={actions.replay}
          onSkip={() => actions.command('dont_know')}
          onPickOption={actions.pickOption}
          speakingOption={vm.speakingOption ?? null}
        />
      ) : (
        <>
          {cliff.rung === 'options' && cliff.options ? <OptionsRung options={cliff.options} onPick={actions.pickOption} speakingOption={vm.speakingOption ?? null} /> : null}
          {cliff.rung === 'hint' && cliff.hint ? <HintRung hint={cliff.hint} /> : null}
          {cliff.nativeAllowed && cliff.rung !== 'free' ? <NativeAllowedChip /> : null}
          <VoiceDock
            title={t('hold.title')}
            subtitle={cliff.rung === 'free' ? t('hold.subtitle') : rungLine(t, plural, cliff)}
            listen={vm.listen}
            onToggle={toggleListen}
            commands={['again', 'slower', 'dont_know']}
            onCommand={(c) => actions.command(c)}
            onType={openTyping}
          />
        </>
      )}
    </>
  );
}

/**
 * The glosses of new words in view: the current sentence's first, then those of the earlier
 * sentences shown above it (the newest first), one per word.
 */
export function passageGlosses(sentence: SentenceView, previous: readonly SentenceView[] = []): SentenceView['glosses'] {
  const seen = new Set<string>();
  const out: SentenceView['glosses'] = [];
  for (const s of [sentence, ...[...previous].reverse()]) {
    for (const g of s.glosses) {
      if (seen.has(g.word)) continue;
      seen.add(g.word);
      out.push(g);
    }
  }
  return out;
}

/** "Every tile is a word you heard. Tap one to hear it again. Hold one to see it, like puesto · stall." */
function TileLegend({ example }: { example?: { word: string; gloss: string } }) {
  const { t } = useI18n();
  if (!example) {
    return (
      <Text variant="hint" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="tile-legend">
        {t('tile.legend')}
      </Text>
    );
  }
  return (
    <TemplateText
      variant="hint"
      tone="muted"
      maxFontSizeMultiplier={CHROME_MAX_SCALE}
      testID="tile-legend"
      template={t('tile.legendLike')}
      values={{ example: <Text variant="hint" style={styles.example}>{t('tile.example', { word: example.word, gloss: firstSense(example.gloss) })}</Text> }}
    />
  );
}

const styles = StyleSheet.create({
  glosses: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  spacer: { flexGrow: 1, minHeight: spacing.lg },
  example: { color: colors.ink },
});
