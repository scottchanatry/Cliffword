import { StyleSheet, View, type ColorValue } from 'react-native';

export interface TabIconProps {
  name: 'story' | 'music';
  color: ColorValue;
}

/**
 * Tab icons drawn with views (no icon font): Story is lines of text that stop at a gap,
 * Music is a note. Decorative; the tab label carries the meaning.
 */
export function TabIcon({ name, color }: TabIconProps) {
  if (name === 'story') {
    return (
      <View style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.line, { backgroundColor: color, width: 20 }]} />
        <View style={[styles.line, { backgroundColor: color, width: 20 }]} />
        <View style={styles.lastRow}>
          <View style={[styles.line, { backgroundColor: color, width: 9 }]} />
          <View style={[styles.gap, { borderColor: color }]} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.stem, { backgroundColor: color }]} />
      <View style={[styles.flag, { backgroundColor: color }]} />
      <View style={[styles.noteHead, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: 24, height: 24, justifyContent: 'center', alignItems: 'center', gap: 3 },
  line: { height: 2.5, borderRadius: 1.25 },
  lastRow: { flexDirection: 'row', alignItems: 'center', gap: 3, width: 20 },
  gap: { width: 8, height: 7, borderWidth: 1.5, borderRadius: 2, borderStyle: 'dashed' },
  stem: { position: 'absolute', left: 13, top: 3, width: 2.5, height: 15 },
  flag: { position: 'absolute', left: 13, top: 3, width: 7, height: 2.5, borderRadius: 1 },
  noteHead: { position: 'absolute', left: 6, top: 14, width: 9, height: 7, borderRadius: 4 },
});
