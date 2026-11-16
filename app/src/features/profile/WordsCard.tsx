import { StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { tKey, useI18n, type CatalogKey } from '../../i18n';
import { colors, radii, spacing } from '../../theme';
import { Card, ContentText, InterfaceText } from '../../ui';
import { PROFILE_SKILLS, weakestSkill, type ProfileSkill, type SkillCounts } from './stats';

const SKILL_LABELS: Readonly<Record<ProfileSkill, CatalogKey>> = {
  meaning: tKey('profile.skill.meaning'),
  sound: tKey('profile.skill.sound'),
  speaking: tKey('profile.skill.speaking'),
};

const FOCUS_HINTS: Readonly<Record<ProfileSkill, CatalogKey>> = {
  meaning: tKey('profile.skills.focus.meaning'),
  sound: tKey('profile.skills.focus.sound'),
  speaking: tKey('profile.skills.focus.speaking'),
};

/** Below this many words in every skill, the mix says it shows up later. */
const EARLY_WORDS = 20;

export interface WordsCardProps {
  /** The engine's estimateVocabulary, rounded. */
  wordsKnown: number;
  skills: SkillCounts;
}

/** Words you understand (the vocabulary estimate) and the skill mix: meaning, sound, speaking. */
export function WordsCard({ wordsKnown, skills }: WordsCardProps) {
  const { t, plural } = useI18n();
  const best = Math.max(1, ...PROFILE_SKILLS.map((s) => skills[s]));
  const early = PROFILE_SKILLS.every((s) => skills[s] < EARLY_WORDS);
  const focus = weakestSkill(skills, undefined, EARLY_WORDS);
  const hint = early ? t('profile.skills.early') : focus ? t(FOCUS_HINTS[focus]) : t('profile.skills.balanced');
  return (
    <Card testID="words-card">
      <InterfaceText variant="eyebrow" tone="muted" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('profile.words.title')}
      </InterfaceText>
      <View style={styles.words}>
        <ContentText variant="display" maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="words-known">
          {String(wordsKnown)}
        </ContentText>
        <InterfaceText variant="body" tone="muted" style={styles.wordsHint} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('profile.words.hint')}
        </InterfaceText>
      </View>
      <View style={styles.mix} testID="skill-mix">
        <InterfaceText variant="eyebrow" tone="muted" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('profile.skills.title')}
        </InterfaceText>
        {PROFILE_SKILLS.map((skill) => {
          const label = t(SKILL_LABELS[skill]);
          const count = plural('profile.skills.words', skills[skill]);
          return (
            <View key={skill} style={styles.skill} accessible accessibilityLabel={t('profile.skills.a11y', { skill: label, count })} testID={`skill-${skill}`}>
              <InterfaceText variant="body" style={styles.skillLabel} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {label}
              </InterfaceText>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round((skills[skill] / best) * 100)}%` }]} />
              </View>
              <InterfaceText variant="caption" tone="muted" style={styles.count} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {String(skills[skill])}
              </InterfaceText>
            </View>
          );
        })}
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="skill-hint">
          {hint}
        </InterfaceText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  words: { gap: spacing.xxs },
  wordsHint: { maxWidth: 300 },
  mix: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  skill: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 28 },
  skillLabel: { width: 104 },
  track: { flex: 1, height: 10, borderRadius: radii.pill, backgroundColor: colors.borderSoft, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.ink },
  count: { width: 44, textAlign: 'right' },
});
