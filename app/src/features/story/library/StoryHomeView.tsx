/**
 * The Story home of an experience: its card (cover, title, city and country, tagline),
 * "Continue: Episode n · <title>" under the episode's scene, the learner's level and what the
 * language model does, the episode list (done ones play again, the next one or the one in progress
 * continues, later ones wait), and "Change experience". Nothing plays here.
 */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AspectImage } from '../../../components/AspectImage';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../../components/words/fontScale';
import { usePairPack } from '../../../engine/PacksProvider';
import { tKey, useI18n, type CatalogKey } from '../../../i18n';
import { ILLUSTRATION_ASPECT, sceneForEpisode } from '../../../illustrations';
import type { StoryActions, StoryViewModel } from '../../../session/contract';
import { borders, colors, layout, radii, spacing } from '../../../theme';
import { Button, ContentText, InterfaceText } from '../../../ui';

import { ExperienceCover } from '../../experiences/ExperienceCover';
import { continueRow, episodeRows, trackOfPair, type EpisodeRow } from '../../experiences/experiences';

/** What the language model line on the home says. */
export type ModelLine = { kind: 'ready' } | { kind: 'downloading'; percent: number } | { kind: 'wifi' } | { kind: 'off' };

const MODE_KEYS: Readonly<Record<'recall' | 'hint' | 'predict', CatalogKey>> = {
  recall: tKey('mode.recall'),
  hint: tKey('mode.hint'),
  predict: tKey('mode.predict'),
};

export interface StoryHomeViewProps {
  vm: StoryViewModel;
  actions: Pick<StoryActions, 'openEpisode' | 'replayEpisode'>;
  onChangeExperience: () => void;
  model?: ModelLine;
}

export function StoryHomeView({ vm, actions, onChangeExperience, model }: StoryHomeViewProps) {
  const { t } = useI18n();
  const pair = usePairPack();
  const library = vm.library;
  if (!library) return null;
  const track = trackOfPair(pair, library.track);
  const rows = episodeRows(pair, library);
  const next = continueRow(rows);
  const progress = library.tracks.find((t) => t.id === library.track);
  const fresh = (progress?.completed.length ?? 0) === 0 && !progress?.playing;
  const mode = library.level <= 1 ? 'recall' : library.level <= 3 ? 'hint' : 'predict';
  const scene = next ? sceneForEpisode(library.track, next.episode) : undefined;
  return (
    <ScrollView contentContainerStyle={styles.content} testID="story-home">
      <View style={styles.card}>
        <ExperienceCover trackId={library.track} dialect={track?.dialect ?? null} motifHeight={120} aspect={HOME_COVER_ASPECT} />
        <View style={styles.cardBody}>
          <ContentText variant="title" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="home-title">
            {track?.title ?? library.track}
          </ContentText>
          {track ? (
            <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {t('experience.place', { city: track.city, country: track.country })}
            </InterfaceText>
          ) : null}
          {track ? (
            <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {track.tagline}
            </InterfaceText>
          ) : null}
        </View>
      </View>
      {next ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(fresh ? 'home.start' : 'home.continue', { n: next.episode, title: next.title })}
          accessibilityState={{ disabled: vm.busy }}
          disabled={vm.busy}
          onPress={actions.openEpisode}
          testID="home-continue"
          style={({ pressed }) => [styles.continueCard, pressed && styles.continuePressed]}
        >
          {scene ? <AspectImage source={scene} aspect={ILLUSTRATION_ASPECT.scenes} testID="home-continue-scene" /> : null}
          <View style={styles.continue}>
            <View style={styles.continueText}>
              <InterfaceText variant="eyebrow" tone="onInk" style={styles.continueEyebrow} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {t(fresh ? 'home.startShort' : 'home.continueShort', { n: next.episode })}
              </InterfaceText>
              <InterfaceText variant="buttonPrimary" tone="onInk" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {next.title}
              </InterfaceText>
              {next.state === 'playing' && next.lines ? (
                <InterfaceText variant="caption" tone="onInk" style={styles.continueEyebrow} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                  {t('home.episode.playing', { line: next.line ?? 0, lines: next.lines })}
                </InterfaceText>
              ) : null}
            </View>
            <View style={styles.play} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={styles.playTriangle} />
            </View>
          </View>
        </Pressable>
      ) : (
        <InterfaceText variant="bodyStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="home-finished">
          {t('home.finished')}
        </InterfaceText>
      )}
      <View style={styles.meta}>
        <InterfaceText variant="caption" tone="mutedStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="home-level">
          {t('home.level', { level: library.level, mode: t(MODE_KEYS[mode]) })}
        </InterfaceText>
        {model ? (
          <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="home-model">
            {model.kind === 'ready'
              ? t('home.model.ready')
              : model.kind === 'downloading'
                ? t('home.model.downloading', { percent: model.percent })
                : model.kind === 'wifi'
                  ? t('home.model.wifi')
                  : t('home.model.off')}
          </InterfaceText>
        ) : null}
      </View>
      <InterfaceText variant="eyebrow" tone="muted" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('home.episodes')}
      </InterfaceText>
      <View style={styles.list} testID="episode-list">
        {rows.map((row) => (
          <EpisodeRowView key={row.episode} row={row} onOpen={actions.openEpisode} onReplay={actions.replayEpisode} disabled={vm.busy} />
        ))}
      </View>
      <Button variant="outline" label={t('picker.change')} onPress={onChangeExperience} testID="home-change" />
    </ScrollView>
  );
}

function EpisodeRowView({ row, onOpen, onReplay, disabled }: { row: EpisodeRow; onOpen: () => void; onReplay: (n: number) => void; disabled: boolean }) {
  const { t } = useI18n();
  const n = row.episode;
  const status =
    row.state === 'done'
      ? t('home.episode.done')
      : row.state === 'playing'
        ? t('home.episode.playing', { line: row.line ?? 0, lines: row.lines ?? 0 })
        : row.state === 'next'
          ? t('home.episode.next')
          : t('home.episode.locked');
  const a11y =
    row.state === 'done'
      ? t('home.episode.a11y.done', { n, title: row.title })
      : row.state === 'playing'
        ? t('home.episode.a11y.playing', { n, title: row.title, line: row.line ?? 0, lines: row.lines ?? 0 })
        : row.state === 'next'
          ? t('home.episode.a11y.next', { n, title: row.title })
          : t('home.episode.a11y.locked', { n, title: row.title });
  const locked = row.state === 'locked';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: locked }}
      disabled={locked || disabled}
      onPress={() => (row.state === 'done' ? onReplay(n) : onOpen())}
      testID={`episode-row-${n}`}
      style={({ pressed }) => [styles.row, row.state === 'next' || row.state === 'playing' ? styles.rowNext : null, pressed && !locked && styles.rowPressed]}
    >
      <View style={[styles.badge, row.state === 'done' ? styles.badgeDone : locked ? styles.badgeLocked : styles.badgeNext]}>
        <InterfaceText variant="pillStrong" tone={row.state === 'done' || locked ? 'ink' : 'onInk'} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {String(n)}
        </InterfaceText>
      </View>
      <View style={styles.rowText}>
        <InterfaceText variant="rowTitle" tone={locked ? 'muted' : 'ink'} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {row.title}
        </InterfaceText>
        <InterfaceText variant="caption" tone={row.state === 'next' || row.state === 'playing' ? 'accent' : 'muted'} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {status}
        </InterfaceText>
      </View>
    </Pressable>
  );
}

/**
 * The cover on the home is cropped a little (from 2:1) so "Start · Episode n", under the episode's
 * scene, stays in view on a small phone (375 x 667).
 */
const HOME_COVER_ASPECT = 2.4;
const BADGE = 32;
const PLAY = 44;

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.screenPaddingX, paddingTop: spacing.sm, paddingBottom: spacing.xxxl, gap: spacing.lg },
  card: { borderRadius: radii.card, backgroundColor: colors.card, overflow: 'hidden' },
  cardBody: { padding: spacing.lg, gap: spacing.xs + 2 },
  meta: { gap: spacing.xs },
  continueCard: { minHeight: 72, borderRadius: radii.card, backgroundColor: colors.ink, overflow: 'hidden' },
  continue: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  continuePressed: { opacity: 0.85 },
  continueText: { flex: 1, gap: spacing.xxs },
  continueEyebrow: { opacity: 0.75 },
  play: { width: PLAY, height: PLAY, borderRadius: PLAY / 2, backgroundColor: colors.live, alignItems: 'center', justifyContent: 'center' },
  playTriangle: {
    width: 0,
    height: 0,
    marginLeft: 4,
    borderTopWidth: 9,
    borderBottomWidth: 9,
    borderLeftWidth: 14,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.ink,
  },
  list: { gap: spacing.sm },
  row: {
    minHeight: layout.primaryHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.list,
    backgroundColor: colors.card,
    borderWidth: borders.strong,
    borderColor: colors.card,
  },
  rowNext: { borderColor: colors.ink },
  rowPressed: { backgroundColor: colors.borderSoft },
  rowText: { flex: 1, gap: spacing.xxs },
  badge: { width: BADGE, height: BADGE, borderRadius: BADGE / 2, alignItems: 'center', justifyContent: 'center' },
  badgeDone: { backgroundColor: colors.heat1 },
  badgeNext: { backgroundColor: colors.ink },
  badgeLocked: { backgroundColor: colors.borderSoft },
});
