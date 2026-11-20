/**
 * The learner's picture (settings.picture): one of the drawn characters (the PNG is already a
 * disc, transparent outside the circle), or their own photo, drawn as a circle with
 * borderRadius. A photo that fails to load (its file went away while the app ran) shows the
 * default character instead. Decorative by default: the text next to it says who it is.
 */
import { useState } from 'react';
import { Image, type StyleProp, type ImageStyle } from 'react-native';
import { tKey, type CatalogKey } from '../i18n';
import { DEFAULT_YOU_AVATAR, YOU_AVATARS, type YouAvatarId } from '../illustrations';
import type { LearnerPicture } from '../storage/repos/settings';
import { colors } from '../theme';

/** Each character's accessible name (what the picture shows). */
export const CHARACTER_LABELS: Readonly<Record<YouAvatarId, CatalogKey>> = {
  you: tKey('picture.character.you'),
  'you-teen': tKey('picture.character.teen'),
  'you-painter': tKey('picture.character.painter'),
  'you-courier': tKey('picture.character.courier'),
  'you-surfer': tKey('picture.character.surfer'),
  'you-backpacker': tKey('picture.character.backpacker'),
  'you-dancer': tKey('picture.character.dancer'),
  'you-remote': tKey('picture.character.remote'),
  'you-dad': tKey('picture.character.dad'),
  'you-doglover': tKey('picture.character.doglover'),
  'you-chef': tKey('picture.character.chef'),
  'you-photographer': tKey('picture.character.photographer'),
  'you-musician': tKey('picture.character.musician'),
  'you-grandma': tKey('picture.character.grandma'),
  'you-captain': tKey('picture.character.captain'),
};

/** The name of a picture: the character's description, or "Your photo". */
export function pictureNameKey(picture: LearnerPicture): CatalogKey {
  return picture.kind === 'character' ? CHARACTER_LABELS[picture.id] : tKey('picture.photo');
}

export interface LearnerAvatarProps {
  picture: LearnerPicture;
  size: number;
  testID?: string;
  style?: StyleProp<ImageStyle>;
}

export function LearnerAvatar({ picture, size, testID, style }: LearnerAvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const hidden = { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no' as const };
  if (picture.kind === 'photo' && failed !== picture.uri) {
    const uri = picture.uri;
    return (
      <Image
        {...hidden}
        source={{ uri }}
        onError={() => setFailed(uri)}
        resizeMode="cover"
        style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.borderSoft }, style]}
        testID={testID}
      />
    );
  }
  const id = picture.kind === 'character' ? picture.id : DEFAULT_YOU_AVATAR;
  return <Image {...hidden} source={YOU_AVATARS[id]} style={[{ width: size, height: size }, style]} testID={testID} />;
}
