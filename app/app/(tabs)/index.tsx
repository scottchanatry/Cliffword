import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePairPack } from '../../src/engine/PacksProvider';
import { CliffCard } from '../../src/features/story/CliffCard';
import { SAMPLE_PASSAGE } from '../../src/features/story/sample';
import { StoryPassage } from '../../src/features/story/StoryPassage';
import { useI18n } from '../../src/i18n';
import { spacing } from '../../src/theme';
import { InterfaceText, Pill, Screen } from '../../src/ui';

/** Story tab placeholder in the Ink look: passage, new-word gloss, cliff card. */
export default function StoryScreen() {
  const { t } = useI18n();
  const pair = usePairPack();
  const [showText, setShowText] = useState(true);
  const passage = SAMPLE_PASSAGE;
  const gloss = pair.gloss(passage.newWord)?.split(',')[0]?.trim();

  return (
    <Screen testID="story-screen">
      <View style={styles.metaRow}>
        <InterfaceText variant="eyebrow" tone="muted" style={styles.meta}>
          {t('story.chapter', { n: passage.chapter, title: passage.title })}
        </InterfaceText>
        <Pill
          label={showText ? t('text.hide') : t('text.show')}
          onPress={() => setShowText((v) => !v)}
          testID="toggle-text"
        />
      </View>
      <StoryPassage passage={passage} showText={showText} gloss={gloss} />
      <View style={styles.spacer} />
      <CliffCard />
    </Screen>
  );
}

const styles = StyleSheet.create({
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  meta: { flex: 1 },
  spacer: { flex: 1 },
});
