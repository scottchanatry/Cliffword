import { StyleSheet, View } from 'react-native';
import { colors } from '../../theme';

/** A small microphone drawn with views (white on ink by default). Decorative. */
export function MicGlyph({ color = colors.onInk }: { color?: string }) {
  return (
    <View style={styles.mic} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.head, { borderColor: color }]} />
      <View style={[styles.cup, { borderColor: color }]} />
      <View style={[styles.stand, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  mic: { alignItems: 'center', width: 20, height: 20, justifyContent: 'flex-start', paddingTop: 1 },
  head: { width: 7, height: 11, borderRadius: 3.5, borderWidth: 2 },
  cup: {
    position: 'absolute',
    top: 6,
    width: 13,
    height: 9,
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderBottomWidth: 2,
  },
  stand: { width: 2, height: 4, marginTop: 3 },
});
