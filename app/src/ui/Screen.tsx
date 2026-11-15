import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, layout } from '../theme';

export interface ScreenProps {
  children?: ReactNode;
  /** Scroll the content (lists, settings). Fixed screens (the cliff) leave it off. */
  scroll?: boolean;
  /** Safe-area edges to pad. Default all but top, because navigators draw the header. */
  edges?: readonly Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A screen on the ground color with the previews' padding (24 at the sides) and gap. */
export function Screen({
  children,
  scroll = false,
  edges = ['left', 'right', 'bottom'],
  contentStyle,
  testID,
}: ScreenProps) {
  return (
    <SafeAreaView edges={edges} style={styles.root} testID={testID}>
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.content, contentStyle]}>{children}</ScrollView>
      ) : (
        <View style={[styles.content, styles.fill, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ground,
  },
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: layout.screenPaddingTop / 2,
    paddingBottom: layout.screenPaddingBottom,
    gap: layout.screenGap,
  },
});
