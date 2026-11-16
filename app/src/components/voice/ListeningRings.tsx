/**
 * The three orange arcs over the hold area (B1, B2). At rest they are drawn as in the design;
 * while listening each ring swells with the microphone level (ListenState.level, 0..1) on the
 * UI thread (Reanimated). With Reduce Motion on, the rings stay still.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { colors } from '../../theme';

/** Ring radii and opacities, as fractions of the width (the design's 120 x 60 viewBox: r 20, 34, 48). */
const RINGS = [
  { r: 20 / 120, opacity: 1 },
  { r: 34 / 120, opacity: 0.6 },
  { r: 48 / 120, opacity: 0.3 },
] as const;

/** Room above the arcs for the swell. */
const HEADROOM = 10;

export interface ListeningRingsProps {
  /** Microphone level 0..1. */
  level: number;
  /** Listening: the rings follow the level. */
  active: boolean;
  /** Width of the drawing (120 in B1, 96 in B2); the height is half of it. */
  width?: number;
  stroke?: number;
  testID?: string;
}

export function ListeningRings({ level, active, width = 120, stroke = 2, testID = 'listening-rings' }: ListeningRingsProps) {
  const reduceMotion = useReducedMotion();
  const animated = active && !reduceMotion;
  const value = useSharedValue(0);
  useEffect(() => {
    const target = animated ? Math.min(1, Math.max(0, level)) : 0;
    value.value = withTiming(target, { duration: 90 });
  }, [animated, level, value]);

  const height = width / 2;
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, { width, height: height + HEADROOM }]}
    >
      {RINGS.map((ring, i) => (
        <Ring key={ring.r} index={i} radius={ring.r * width} opacity={ring.opacity} centerX={width / 2} centerY={height + HEADROOM - 2} stroke={stroke} level={value} still={!animated} />
      ))}
    </View>
  );
}

interface RingProps {
  index: number;
  radius: number;
  opacity: number;
  centerX: number;
  centerY: number;
  stroke: number;
  level: SharedValue<number>;
  still: boolean;
}

function Ring({ index, radius, opacity, centerX, centerY, stroke, level, still }: RingProps) {
  const style = useAnimatedStyle(() => {
    const l = still ? 0 : level.value;
    return {
      opacity: Math.min(1, opacity * (1 + l * 0.8)),
      transform: [{ scale: 1 + l * (0.06 + index * 0.05) }],
    };
  });
  return (
    <Animated.View
      testID={`listening-ring-${index}`}
      style={[
        styles.ring,
        {
          left: centerX - radius,
          top: centerY - radius,
          width: radius * 2,
          height: radius * 2,
          borderRadius: radius,
          borderWidth: stroke,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', alignSelf: 'center' },
  ring: { position: 'absolute', borderColor: colors.live },
});
