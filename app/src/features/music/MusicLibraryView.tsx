import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n, type Translator } from '../../i18n';
import { colors, fontFamilies, radii, spacing } from '../../theme';
import { Button, Card, MusicHeading, Screen, Text } from '../../ui';
import { ExplicitRow } from './ExplicitRow';
import { LibraryList, ListRow, Monogram } from './LibraryList';
import { RegionPills } from './RegionPills';
import { SourceRow } from './SourceRow';
import { SpotifyHowToSheet } from './SpotifyHowToSheet';
import type { AppleMusicStatus, MusicLibraryProps } from './types';

/** The Apple Music row by authorization state: its status line and its action (none while checking or where it does not exist). */
export function appleMusicRow(
  t: Translator['t'],
  status: AppleMusicStatus,
  os: string = Platform.OS,
): { hint: string; action: 'connect' | 'manage' | null } {
  switch (status) {
    case 'authorized':
      return { hint: t('music.appleMusic.connected'), action: 'manage' };
    case 'notDetermined':
      return { hint: t('music.appleMusic.notDetermined'), action: 'connect' };
    case 'denied':
      return { hint: t('music.appleMusic.denied'), action: 'manage' };
    case 'restricted':
      return { hint: t('music.appleMusic.restricted'), action: null };
    case 'checking':
      return { hint: t('music.appleMusic.checking'), action: null };
    case 'unsupported':
      return { hint: os === 'android' ? t('music.appleMusic.android') : t('music.appleMusic.unsupported'), action: null };
  }
}

/**
 * Your music (C3): where songs come from (Apple Music, Spotify share-in, pasted lyrics), the
 * songs in the library with what their lyrics hold, Apple Music songs to add, shared songs and
 * texts waiting, the slang regions to learn and the explicit-lyrics switch (ON by default).
 */
export function MusicLibraryView(props: MusicLibraryProps) {
  const { t, plural } = useI18n();
  const [howTo, setHowTo] = useState(false);
  const apple = appleMusicRow(t, props.appleMusic, props.os);
  const showSpotify = () => {
    setHowTo(true);
    props.onShowSpotifyHowTo();
  };
  return (
    <Screen scroll testID="music-screen" contentStyle={styles.content}>
      <MusicHeading>{t('music.title')}</MusicHeading>
      <Card style={styles.list}>
        <SourceRow
          title={t('music.appleMusic')}
          hint={apple.hint}
          actionLabel={apple.action === 'connect' ? t('action.connect') : apple.action === 'manage' ? t('action.manage') : undefined}
          onAction={apple.action === 'connect' ? props.onConnectAppleMusic : apple.action === 'manage' ? props.onManageAppleMusic : undefined}
          divider
          testID="source-apple-music"
        />
        <SourceRow title={t('music.spotify')} hint={t('music.spotify.hint')} actionLabel={t('action.showMe')} onAction={showSpotify} divider testID="source-spotify" />
        <SourceRow title={t('music.lyrics')} hint={t('music.lyrics.hint')} actionLabel={t('action.paste')} onAction={props.onPasteLyrics} primary testID="source-lyrics" />
      </Card>

      {props.loading ? (
        <ActivityIndicator color={colors.muted} accessibilityLabel={t('music.loading')} testID="library-loading" />
      ) : (
        <>
          <Section label={t('music.fromLibrary')}>
            {props.songs.length > 0 ? (
              <LibraryList songs={props.songs} onOpen={props.onOpenSong} />
            ) : (
              <Card tone="soft" testID="library-empty">
                <Text variant="body" tone="mutedStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                  {t('music.empty')}
                </Text>
              </Card>
            )}
          </Section>
          {props.appleMusic === 'authorized' && props.appleLibrary.length > 0 ? (
            <Section label={t('music.appleLibrary')}>
              <View style={styles.card} testID="apple-library">
                {props.appleLibrary.map((song, i) => (
                  <ListRow
                    key={song.id}
                    title={song.title}
                    meta={song.artist}
                    trailing={
                      <Button
                        variant="outline"
                        label={t('action.add')}
                        accessibilityLabel={t('music.appleLibrary.add', { title: song.title })}
                        onPress={() => props.onAddAppleSong(song.id)}
                        style={styles.rowButton}
                        testID={`apple-add-${song.id}`}
                      />
                    }
                    divider={i < props.appleLibrary.length - 1}
                    testID={`apple-song-${song.id}`}
                  />
                ))}
              </View>
            </Section>
          ) : null}
          {props.shares.length > 0 ? (
            <Section label={t('music.shares')}>
              <View style={styles.card} testID="shared-songs">
                {props.shares.map((share, i) => (
                  <ListRow
                    key={share.id}
                    title={share.title ?? t('music.share.unknown')}
                    meta={share.artist ?? ''}
                    leading={<Monogram letters={(share.title ?? '?').slice(0, 1).toUpperCase()} index={i + 1} />}
                    onPress={() => props.onOpenShare(share.id)}
                    hint={t('music.share.hint')}
                    divider={i < props.shares.length - 1}
                    testID={`share-${share.id}`}
                  />
                ))}
              </View>
            </Section>
          ) : null}
          {props.texts.length > 0 ? (
            <Section label={t('music.texts')}>
              <View style={styles.card} testID="brought-texts">
                {props.texts.map((text, i) => (
                  <ListRow
                    key={text.id}
                    title={text.title || t('text.untitled')}
                    meta={plural('music.text.sentences', text.sentences)}
                    onPress={() => props.onOpenText(text.id)}
                    divider={i < props.texts.length - 1}
                    testID={`text-${text.id}`}
                  />
                ))}
              </View>
            </Section>
          ) : null}
        </>
      )}

      <Section label={t('music.slangToLearn')}>
        <RegionPills selected={props.regions} onToggle={props.onToggleRegion} />
      </Section>
      <View style={styles.spacer} />
      <ExplicitRow show={props.showExplicit} onToggle={props.onToggleExplicit} />
      <Button variant="ghost" label={t('music.bringText')} accessibilityHint={t('music.bringText.hint')} onPress={props.onBringText} style={styles.bring} testID="bring-text" />
      <SpotifyHowToSheet visible={howTo} onClose={() => setHowTo(false)} />
    </Screen>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="eyebrow" style={styles.eyebrow} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {label}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: spacing.md + 2 },
  list: { paddingVertical: spacing.xs, paddingHorizontal: spacing.lg, gap: 0, borderRadius: radii.list },
  card: { paddingVertical: spacing.xs, paddingHorizontal: spacing.lg, borderRadius: radii.list, backgroundColor: colors.card },
  section: { gap: spacing.md + 2 },
  eyebrow: { fontFamily: fontFamilies.interfaceBold },
  rowButton: { minHeight: 44 },
  bring: { alignSelf: 'flex-start', marginLeft: -spacing.sm },
  spacer: { flexGrow: 1, minHeight: spacing.sm },
});
