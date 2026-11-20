/**
 * The learner's picture chooser, shared by onboarding ("Who are you in the story?") and Settings
 * ("Your picture"): the chosen picture large at the top; the nine characters in three columns,
 * circles with a ring on the chosen one (radios for screen readers, each named by what it shows);
 * "Take a selfie" and "Choose a photo" where the device offers them; "Remove photo" while a photo
 * is the picture; and a notice when a photo did not work (how to allow it in Settings, or that the
 * picture stayed). Plain props: usePictureChooser holds the behaviour.
 */
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { PhotoSource } from '../../adapters/photo/types';
import { CHARACTER_LABELS, LearnerAvatar, pictureNameKey } from '../../components/LearnerAvatar';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { YOU_AVATAR_IDS, YOU_AVATARS, type YouAvatarId } from '../../illustrations';
import type { LearnerPicture } from '../../storage/repos/settings';
import { colors, layout, radii, spacing } from '../../theme';
import { Button, Card, InterfaceText } from '../../ui';
import type { PictureNotice } from './usePictureChooser';

/** A character's circle, in points; the ring sits around it. */
export const CHARACTER_SIZE = 88;
/** The picture at the top. */
export const PREVIEW_SIZE = 112;
/**
 * On a short screen (an iPhone SE, 667 pt) both are a little smaller, so the onboarding step's
 * Continue shows without scrolling when no photo buttons are added below the grid.
 */
export const COMPACT = { below: 720, character: 80, preview: 80 } as const;
const RING = 3;
const RING_GAP = 3;

export interface PictureChooserProps {
  picture: LearnerPicture;
  /** The photo sources this device offers, in order; none hides the photo buttons. */
  sources: readonly PhotoSource[];
  busy: boolean;
  notice: PictureNotice | null;
  onChooseCharacter: (id: YouAvatarId) => void;
  onPickPhoto: (source: PhotoSource) => void;
  /** Offered while a photo is the picture. */
  onRemovePhoto?: () => void;
  onOpenSettings: () => void;
  testID?: string;
}

export function PictureChooser({ picture, sources, busy, notice, onChooseCharacter, onPickPhoto, onRemovePhoto, onOpenSettings, testID = 'picture-chooser' }: PictureChooserProps) {
  const { t } = useI18n();
  const { height } = useWindowDimensions();
  const compact = height > 0 && height < COMPACT.below;
  const character = compact ? COMPACT.character : CHARACTER_SIZE;
  const cell = character + 2 * (RING + RING_GAP);
  const name = t(pictureNameKey(picture));
  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.preview} accessible accessibilityRole="image" accessibilityLabel={t('picture.current', { name })} testID="picture-preview">
        <LearnerAvatar picture={picture} size={compact ? COMPACT.preview : PREVIEW_SIZE} testID="picture-preview-image" />
      </View>

      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={t('picture.characters')} testID="picture-characters">
        {YOU_AVATAR_IDS.map((id) => {
          const selected = picture.kind === 'character' && picture.id === id;
          return (
            <View key={id} style={styles.cell}>
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={t(CHARACTER_LABELS[id])}
                accessibilityState={{ checked: selected, selected, disabled: busy }}
                // react-native-web 0.21 reads only the aria-* form of the checked state.
                aria-checked={selected}
                disabled={busy}
                onPress={() => onChooseCharacter(id)}
                testID={`picture-character-${id}`}
                style={({ pressed }) => [styles.ring, { width: cell, height: cell }, selected && styles.ringSelected, pressed && !busy && styles.ringPressed]}
              >
                <Image
                  source={YOU_AVATARS[id]}
                  accessible={false}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={{ width: character, height: character }}
                  testID={`picture-character-${id}-image`}
                />
              </Pressable>
            </View>
          );
        })}
      </View>

      {sources.length > 0 ? (
        <View style={styles.photo}>
          <View style={styles.buttons}>
            {sources.map((source) => (
              <Button
                key={source}
                variant="outline"
                label={source === 'camera' ? t('picture.selfie') : t('picture.library')}
                onPress={() => onPickPhoto(source)}
                disabled={busy}
                style={styles.button}
                testID={`picture-${source}`}
              />
            ))}
          </View>
          {picture.kind === 'photo' && onRemovePhoto ? (
            <Button variant="ghost" label={t('picture.remove')} onPress={onRemovePhoto} disabled={busy} testID="picture-remove" />
          ) : null}
          <InterfaceText variant="caption" tone="muted" style={styles.center} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('picture.private')}
          </InterfaceText>
        </View>
      ) : null}

      {notice ? (
        <Card tone="soft" testID="picture-notice">
          <InterfaceText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {notice.kind === 'denied' ? t(notice.source === 'camera' ? 'picture.denied.camera' : 'picture.denied.library') : t('picture.error')}
          </InterfaceText>
          {notice.kind === 'denied' ? (
            <Button variant="outline" label={t('permission.openSettings')} onPress={onOpenSettings} testID="picture-open-settings" />
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  preview: { alignSelf: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm },
  cell: { width: '33.333%', alignItems: 'center' },
  ring: {
    minHeight: layout.minTouch,
    padding: RING_GAP,
    borderRadius: radii.pill,
    borderWidth: RING,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringSelected: { borderColor: colors.ink },
  ringPressed: { backgroundColor: colors.borderSoft },
  photo: { gap: spacing.sm },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: { flexGrow: 1, flexBasis: 140 },
  center: { textAlign: 'center' },
});
