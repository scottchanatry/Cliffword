import { Image, StyleSheet, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';

export interface AspectImageProps {
  source: ImageSourcePropType;
  /** width / height. The picture fills it, cropped evenly when its own shape differs. */
  aspect: number;
  /** The frame's style (corners, opacity, margins); it is as wide as its parent allows. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A decorative picture at the full width it is given and a fixed shape (covers, scenes). The
 * ratio sits on a frame the image fills: React Native Web sizes an Image by its file's own height
 * and ignores aspectRatio on the Image itself. Hidden from screen readers.
 */
export function AspectImage({ source, aspect, style, testID }: AspectImageProps) {
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.frame, { aspectRatio: aspect }, style]}
      testID={testID}
    >
      <Image source={source} accessible={false} resizeMode="cover" style={styles.fill} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
});
