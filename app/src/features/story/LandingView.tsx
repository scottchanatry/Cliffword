import { Text as Span, StyleSheet, View } from 'react-native';
import { looseText, type UiText } from '@cliffword/engine';
import { answerSpan } from '../../components/words/answerSpan';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { templateParts } from '../../components/words/TemplateText';
import { UnderstoodLine } from '../../components/words/UnderstoodLine';
import { WordFlow } from '../../components/words/WordFlow';
import { useI18n } from '../../i18n';
import { useServices } from '../../services/ServicesProvider';
import { colors, spacing } from '../../theme';
import { Text } from '../../ui';
import { lookOf } from './CliffView';
import { LandingLine } from './LandingLine';
import { chapterLine, MetaRow, SpokenRight } from './StoryHeader';
import type { KindViewProps } from './types';
import { VoiceDock } from './VoiceDock';

/**
 * Where the answer landed (B2): the sentence with the answer's words lit, the headline for
 * the credit reason, the surprising -> expected line, "About N times in 100" and "X is just as
 * natural", then "Hold anywhere, say the whole line" (shadowing: "Understood N of M words").
 */
export function LandingView({ screen, vm, actions, toggleListen, openTyping }: KindViewProps<'landing'>) {
  const { t } = useI18n();
  const { packs } = useServices();
  const { outcome, sentence } = screen;
  const look = lookOf(vm, sentence);
  const span = answerSpan(packs.lang, sentence, outcome.expected);
  const saidOther = looseText(packs.lang, outcome.answer) !== looseText(packs.lang, outcome.expected);
  return (
    <>
      <MetaRow canned={vm.modelMode === 'canned'} text={chapterLine(t, screen.meta)} busy={vm.busy} right={<SpokenRight ms={vm.spokenTodayMs} />} />
      <WordFlow
        sentence={sentence}
        previous={look === 'ink' ? vm.previous : []}
        look={look}
        speakingWord={vm.speakingWord}
        highlight={span}
        onHear={actions.hearWord}
        onReveal={actions.revealWord}
      />
      {saidOther && outcome.answer.trim() ? (
        <Text variant="hint" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="landing-you-said">
          {t('landing.youSaid', { answer: outcome.answer.trim() })}
        </Text>
      ) : null}
      <Text variant="headline" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="landing-headline">
        {t(outcome.headline.key, outcome.headline.params)}
      </Text>
      {outcome.points.length > 0 ? <LandingLine points={outcome.points} /> : null}
      <LandingNotes notes={outcome.notes} explanation={outcome.explanation} bounded={outcome.bounded === true} />
      {screen.shadow ? <UnderstoodLine alignment={screen.shadow} /> : null}
      <View style={styles.spacer} />
      <VoiceDock
        title={t('hold.wholeLine')}
        subtitle={t('hold.matchPace')}
        listen={vm.listen}
        onToggle={toggleListen}
        commands={['again', 'meaning', 'next']}
        onCommand={(c) => actions.command(c)}
        onType={openTyping}
        height={150}
        ringsWidth={96}
      />
    </>
  );
}

/** The landing notes in one muted paragraph; a word they name ("leerla") is in ink. */
function LandingNotes({ notes, explanation, bounded }: { notes: readonly UiText[]; explanation?: UiText; bounded: boolean }) {
  const { t } = useI18n();
  const all = [...notes, ...(explanation ? [explanation] : [])];
  if (all.length === 0 && !bounded) return null;
  return (
    <Text variant="body" tone="muted" style={styles.notes} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="landing-notes">
      {all.map((note, i) => {
        const word = note.params?.word;
        return (
          <Span key={`${note.key}-${i}`}>
            {i > 0 ? t('landing.noteSeparator') : null}
            {word !== undefined ? (
              templateParts(t(note.key), { ...stringValues(note.params), word: <Span style={styles.ink}>{String(word)}</Span> })
            ) : (
              t(note.key, note.params)
            )}
          </Span>
        );
      })}
      {bounded ? (
        <Span>
          {all.length > 0 ? t('landing.noteSeparator') : null}
          {t('landing.bounded')}
        </Span>
      ) : null}
    </Text>
  );
}

function stringValues(params: UiText['params']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params ?? {})) out[k] = String(v);
  return out;
}

const styles = StyleSheet.create({
  notes: { lineHeight: 22 },
  ink: { color: colors.ink },
  spacer: { flexGrow: 1, minHeight: spacing.lg },
});
