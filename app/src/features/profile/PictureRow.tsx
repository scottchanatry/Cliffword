/**
 * Settings' "Your picture" row: the learner's picture and its name, "Change" (the same chooser as
 * onboarding, in a sheet over Settings) and, while a photo is the picture, "Remove photo".
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LearnerAvatar, pictureNameKey } from '../../components/LearnerAvatar';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { colors, layout, radii, spacing } from '../../theme';
import { Button, InterfaceText, Screen } from '../../ui';
import { PictureChooser, type PictureChooserProps } from '../picture/PictureChooser';
import { ModalHeader } from './ModalHeader';

export type PictureRowProps = Omit<PictureChooserProps, 'testID'>;

/** The picture in the row, in points. */
const ROW_AVATAR = 56;

export function PictureRow(props: PictureRowProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { picture, busy, onRemovePhoto } = props;
  const name = t(pictureNameKey(picture));
  return (
    <View style={styles.field} testID="settings-picture">
      <View style={styles.row}>
        <LearnerAvatar picture={picture} size={ROW_AVATAR} testID="settings-picture-avatar" />
        <View style={styles.text}>
          <InterfaceText variant="rowTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('settings.picture')}
          </InterfaceText>
          <InterfaceText variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="settings-picture-name">
            {name}
          </InterfaceText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.picture.change')}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.change, pressed && styles.changePressed]}
          testID="settings-picture-change"
        >
          <InterfaceText variant="pillStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('settings.experience.change')}
          </InterfaceText>
        </Pressable>
      </View>
      {picture.kind === 'photo' && onRemovePhoto ? (
        <Button variant="outline" label={t('picture.remove')} onPress={onRemovePhoto} disabled={busy} style={styles.remove} testID="settings-picture-remove" />
      ) : null}

      {open ? (
        <Modal visible animationType="slide" onRequestClose={() => setOpen(false)} testID="settings-picture-sheet">
          <SafeAreaView style={styles.sheet} edges={['top', 'left', 'right', 'bottom']}>
            <Screen scroll edges={[]}>
              <ModalHeader title={t('settings.picture')} actionLabel={t('common.done')} onAction={() => setOpen(false)} actionTestID="settings-picture-done" />
              <PictureChooser {...props} testID="settings-picture-chooser" />
            </Screen>
          </SafeAreaView>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: spacing.xxs },
  change: {
    minHeight: layout.minTouch,
    minWidth: layout.minTouch,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePressed: { backgroundColor: colors.borderSoft },
  remove: { alignSelf: 'flex-start' },
  sheet: { flex: 1, backgroundColor: colors.ground },
});
