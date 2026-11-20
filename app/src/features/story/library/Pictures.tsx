/**
 * The pictures of an episode (src/illustrations): a speaker's avatar and name, the episode's scene,
 * and the pictures of the words of a line. Avatars and scenes are decorative (hidden from screen
 * readers: the name and the text say it); a word picture is labelled with its word.
 */
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { AspectImage } from '../../../components/AspectImage';
import { CHROME_MAX_SCALE } from '../../../components/words/fontScale';
import { ILLUSTRATION_ASPECT, castForSpeaker, sceneForEpisode, type WordPicture } from '../../../illustrations';
import { colors, radii, spacing } from '../../../theme';
import { InterfaceText, type TextTone } from '../../../ui';

/** A round avatar (the PNG is already a disc); nothing when there is no picture. */
export function Avatar({ source, size = 40, testID }: { source: ImageSourcePropType | undefined; size?: number; testID?: string }) {
  if (!source) return null;
  return <Image source={source} accessible={false} accessibilityElementsHidden importantForAccessibility="no" style={{ width: size, height: size }} testID={testID} />;
}

/**
 * Who speaks: the avatar of the speaker's cast id in the track's series, then the label (the
 * name, or "Doña Mari asks you"). Narration (no name) shows nothing.
 */
export function SpeakerLabel({
  trackId,
  speakerId,
  label,
  tone = 'accent',
  size = 40,
  testID = 'episode-speaker',
}: {
  trackId: string | null | undefined;
  speakerId: string | null | undefined;
  label: string | null;
  tone?: TextTone;
  size?: number;
  testID?: string;
}) {
  if (!label) return null;
  return (
    <View style={styles.speaker}>
      <Avatar source={castForSpeaker(trackId, speakerId)} size={size} testID={`${testID}-avatar`} />
      <InterfaceText variant="eyebrow" tone={tone} style={styles.speakerText} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={testID}>
        {label}
      </InterfaceText>
    </View>
  );
}

/** The episode's scene, full width with rounded corners; nothing when the series has none. */
export function SceneBanner({ trackId, episode }: { trackId: string | null | undefined; episode: number | null | undefined }) {
  const scene = sceneForEpisode(trackId, episode);
  if (!scene) return null;
  return <AspectImage source={scene} aspect={ILLUSTRATION_ASPECT.scenes} style={styles.scene} testID="episode-scene" />;
}

/**
 * The episode's scene, whole but small (`height` points tall, centered), for the band under the
 * episode header while the episode opens: there it stays in view whatever the line below needs.
 * Nothing when the series has none.
 */
export function SceneStrip({ trackId, episode, height }: { trackId: string | null | undefined; episode: number | null | undefined; height: number }) {
  const scene = sceneForEpisode(trackId, episode);
  if (!scene) return null;
  return (
    <View style={styles.strip} testID="episode-scene-strip">
      <View style={{ width: Math.round(height * ILLUSTRATION_ASPECT.scenes), height }}>
        <AspectImage source={scene} aspect={ILLUSTRATION_ASPECT.scenes} style={styles.stripScene} testID="episode-scene" />
      </View>
    </View>
  );
}

/** Small pictures of the words of a line that have one, each with its word. */
export function WordPictures({ words, size = 52, testID = 'word-pictures' }: { words: readonly WordPicture[]; size?: number; testID?: string }) {
  if (words.length === 0) return null;
  return (
    <View style={styles.words} testID={testID}>
      {words.map((w) => (
        <View key={w.id} style={styles.word} accessible accessibilityRole="image" accessibilityLabel={w.word} testID={`${testID}-${w.id}`}>
          <Image source={w.image} style={{ width: size, height: size }} />
          <InterfaceText variant="caption" tone="mutedStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {w.word}
          </InterfaceText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  speaker: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  speakerText: { flexShrink: 1 },
  scene: { borderRadius: radii.card, backgroundColor: colors.borderSoft },
  strip: { alignItems: 'center', paddingTop: spacing.sm },
  stripScene: { borderRadius: radii.panel, backgroundColor: colors.borderSoft },
  words: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  word: { alignItems: 'center', gap: spacing.xxs, minWidth: 52 },
});
