import { StyleSheet, View } from 'react-native';
import { locateAnswer, looseText, type UiText } from '@cliffword/engine';
import { CommandChips } from '../../components/voice/CommandChips';
import { MicGlyph } from '../../components/voice/MicGlyph';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { useServices } from '../../services/ServicesProvider';
import { spacing } from '../../theme';
import { Button, Text } from '../../ui';
import { LandingLine } from '../story/LandingLine';
import { lineOf } from './LyricCliffView';
import { LyricLine } from './LyricLine';
import { rawLineWords } from './lyricWords';
import { SongHeader } from './SongHeader';
import type { LyricKindProps } from './viewTypes';

/**
 * Where a lyric answer landed (the story's landing look, B2): the line with the song's own
 * words lit, "You said …" when the answer differs, the headline for the credit reason, the
 * surprising -> expected line when the answer was scored, the notes (and why a street or
 * spelling variant counted), then "Sing the line back" and the commands.
 */
export function LyricResultView({ screen, vm, actions }: LyricKindProps<'result'>) {
  const { t } = useI18n();
  const { packs } = useServices();
  const { outcome } = screen;
  const words = rawLineWords(packs.lang, screen.line, { regions: vm.regions, showExplicit: vm.showExplicit });
  const span = locateAnswer(packs.lang, screen.line, outcome.expected);
  const saidOther = outcome.answer.trim() !== '' && looseText(packs.lang, outcome.answer) !== looseText(packs.lang, outcome.expected);
  const notes: UiText[] = [...outcome.notes, ...(outcome.explanation ? [outcome.explanation] : [])];
  return (
    <>
      <SongHeader meta={screen.meta} subtitle={lineOf(t, screen.meta, screen.lineIndex)} size="small" busy={vm.busy} />
      <LyricLine
        words={words}
        look="ink"
        underlineSlang={false}
        highlight={(i) => span !== null && i >= span.wordIndex && i < span.wordIndex + span.length}
        testID="result-line"
      />
      {saidOther ? (
        <Text variant="hint" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="result-you-said">
          {t('landing.youSaid', { answer: outcome.answer.trim() })}
        </Text>
      ) : null}
      <Text variant="headline" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="result-headline">
        {t(outcome.headline.key, outcome.headline.params)}
      </Text>
      {outcome.points.length > 0 ? <LandingLine points={outcome.points} testID="result-landing-line" /> : null}
      {notes.length > 0 || outcome.bounded ? (
        <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="result-notes">
          {[...notes.map((n) => t(n.key, n.params)), ...(outcome.bounded ? [t('landing.bounded')] : [])].join(t('landing.noteSeparator'))}
        </Text>
      ) : null}
      <View style={styles.spacer} />
      <Button label={t('music.singBackLine')} icon={<MicGlyph />} onPress={actions.startEcho} testID="start-echo" />
      <CommandChips commands={['again', 'meaning', 'next']} onCommand={(c) => actions.command(c)} />
    </>
  );
}

const styles = StyleSheet.create({
  spacer: { flexGrow: 1, minHeight: spacing.lg },
});
