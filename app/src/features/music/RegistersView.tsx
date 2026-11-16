import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { slangNotes } from '@cliffword/engine';
import { MicGlyph } from '../../components/voice/MicGlyph';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { useServices } from '../../services/ServicesProvider';
import { borders, colors, fontFamilies, layout, radii, spacing } from '../../theme';
import { Button, Card, MusicHeading, Text } from '../../ui';
import { rawLineWords } from './lyricWords';
import { mainRegion, regionLabel } from './regionNames';
import { RegisterPairCard, SwapList } from './RegisterPairCard';
import type { LyricKindProps } from './viewTypes';

/** The pairs with the line that changes most first (the clearest example), the rest in song order. */
export function featuredFirst<P extends { lineIndex: number; swaps: readonly unknown[] }>(pairs: readonly P[]): P[] {
  let best = 0;
  pairs.forEach((p, i) => {
    if (p.swaps.length > (pairs[best]?.swaps.length ?? 0)) best = i;
  });
  const first = pairs[best];
  return first ? [first, ...pairs.filter((_, i) => i !== best)] : [];
}

/**
 * Same idea, two ways to say it (C2): the line that changes most, as the neutral card and the
 * street card (labelled with where the street words are heard) and the words that change; the
 * song's other lines with slang one tap away.
 * "Say it street" and "Say it neutral" set the register the learner practises; the song page
 * is one tap away.
 */
export function RegistersView({ screen, vm, actions }: LyricKindProps<'registers'>) {
  const { t, plural } = useI18n();
  const { packs } = useServices();
  const [all, setAll] = useState(false);
  const spanOpts = { regions: vm.regions, showExplicit: vm.showExplicit };
  const register = screen.meta.register;
  const pairs = featuredFirst(screen.pairs);
  const shown = all ? pairs : pairs.slice(0, 1);
  return (
    <>
      <MusicHeading variant="musicHeading" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {t('register.title')}
      </MusicHeading>
      {screen.pairs.length === 0 ? (
        <Card tone="soft" testID="registers-none">
          <Text variant="body" tone="mutedStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('register.none')}
          </Text>
        </Card>
      ) : null}
      {shown.map((pair) => {
        const region = mainRegion(slangNotes(pair.street, packs.lang, packs.pair, { regions: vm.regions ?? [] }));
        return (
          <View key={pair.lineIndex} style={styles.pair} testID={`register-pair-${pair.lineIndex}`}>
            <RegisterPairCard
              register="neutral"
              label={t('register.neutral.label')}
              words={rawLineWords(packs.lang, pair.neutral, spanOpts)}
              current={register === 'neutral'}
              testID={`register-neutral-${pair.lineIndex}`}
            />
            <RegisterPairCard
              register="street"
              label={region ? t('register.street.label', { region: regionLabel(t, region) }) : t('register.street.labelPlain')}
              words={rawLineWords(packs.lang, pair.street, spanOpts)}
              current={register === 'street'}
              testID={`register-street-${pair.lineIndex}`}
            />
            <SwapList swaps={pair.swaps} testID={`swaps-${pair.lineIndex}`} />
          </View>
        );
      })}
      {pairs.length > 1 ? (
        <Button
          variant="ghost"
          label={all ? t('register.fewerLines') : plural('register.moreLines', pairs.length - 1)}
          onPress={() => setAll((a) => !a)}
          style={styles.more}
          testID="registers-more"
        />
      ) : null}
      <View style={styles.spacer} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('register.sayStreet')}
        accessibilityState={{ selected: register === 'street' }}
        onPress={() => actions.setRegister('street')}
        testID="say-street"
        style={({ pressed }) => [styles.street, pressed && styles.pressed]}
      >
        <MicGlyph />
        <Text variant="musicButton" tone="onInk" style={styles.streetText} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('register.sayStreet')}
        </Text>
      </Pressable>
      <Button
        variant="outline"
        label={t('register.sayNeutral')}
        onPress={() => actions.setRegister('neutral')}
        style={styles.neutral}
        testID="say-neutral"
      />
      <Text variant="hint" maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.advice}>
        {t('register.advice')}
      </Text>
      <Button variant="ghost" label={t('music.backToSong')} onPress={actions.showSong} testID="show-song" />
    </>
  );
}

const styles = StyleSheet.create({
  pair: { gap: spacing.md + 2 },
  more: { alignSelf: 'flex-start', marginLeft: -spacing.sm },
  spacer: { flexGrow: 1, minHeight: spacing.lg },
  street: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    borderRadius: radii.list,
    backgroundColor: colors.ink,
  },
  streetText: { fontSize: 24, lineHeight: 30, letterSpacing: 0.72 },
  pressed: { opacity: 0.85 },
  neutral: { minHeight: 48, borderWidth: borders.strong, borderColor: colors.ink, borderRadius: radii.panel },
  advice: { minHeight: layout.minTouch / 2, fontFamily: fontFamilies.interfaceMedium },
});
