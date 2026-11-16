import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { LandingPoint } from '@cliffword/engine';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { colors, fontFamilies } from '../../theme';
import { Text } from '../../ui';

/** Points sit between these fractions of the width, so labels at the ends stay inside. */
const X_MIN = 0.06;
const X_SPAN = 0.88;
const LABEL_BOX = 120;

type Slot = 'below' | 'above' | 'lower';
const SLOT_TOP: Record<Slot, number> = { above: 28, below: 72, lower: 90 };

export interface PlacedPoint {
  point: LandingPoint;
  /** 0..1 along the line. */
  left: number;
  /** Where its label goes; null when every slot near it is taken (the dot alone). */
  slot: Slot | 'answer' | null;
}

/** Rough label width in dp (Inter 14 / Newsreader 20), for collision checks only. */
function labelWidth(text: string, answer: boolean): number {
  return text.length * (answer ? 10 : 7.5) + 8;
}

/** Dots closer than this (dp) are nudged apart, keeping their order. */
const MIN_DOT_GAP = 16;

/**
 * Spreads sorted positions (dp) so neighbours are at least `gap` apart, inside [lo, hi]:
 * pushed right where they crowd, then pulled back from the right edge. Order never changes.
 */
export function spreadPositions(sorted: readonly number[], gap: number, lo: number, hi: number): number[] {
  const out = sorted.map((v) => Math.min(hi, Math.max(lo, v)));
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i] as number, (out[i - 1] as number) + gap);
  for (let i = out.length - 1; i >= 0; i--) {
    const limit = i === out.length - 1 ? hi : (out[i + 1] as number) - gap;
    out[i] = Math.max(lo, Math.min(out[i] as number, limit));
  }
  return out;
}

/**
 * Places the landing points: dots along the line by LandingPoint.x, nudged apart where
 * probabilities tie; the answer's label goes above its large dot; every other label takes the
 * first free slot (below, above, lower) that does not overlap a label already in it, or none.
 * Same input, same layout.
 */
export function placePoints(points: readonly LandingPoint[], width: number): PlacedPoint[] {
  const placed: PlacedPoint[] = [];
  const taken: Record<Slot | 'answer', { center: number; half: number }[]> = { answer: [], below: [], above: [], lower: [] };
  const fits = (slot: Slot | 'answer', center: number, half: number) => taken[slot].every((o) => Math.abs(o.center - center) >= o.half + half + 4);
  const byX = [...points].sort((a, b) => a.x - b.x || Number(a.answer) - Number(b.answer));
  const spread = spreadPositions(
    byX.map((p) => (X_MIN + Math.min(1, Math.max(0, p.x)) * X_SPAN) * width),
    MIN_DOT_GAP,
    X_MIN * width,
    (X_MIN + X_SPAN) * width,
  );
  const centerOf = new Map(byX.map((p, i) => [p, spread[i] as number]));
  const sorted = [...points].sort((a, b) => Number(b.answer) - Number(a.answer) || a.x - b.x);
  for (const point of sorted) {
    const center = centerOf.get(point) ?? 0;
    const left = width > 0 ? center / width : 0;
    const half = labelWidth(point.text, point.answer) / 2;
    let slot: PlacedPoint['slot'] = null;
    if (point.answer) slot = 'answer';
    else {
      for (const s of ['below', 'above', 'lower'] as const) {
        // The upper slot shares its height with the answer's label.
        if (fits(s, center, half) && (s !== 'above' || fits('answer', center, half))) {
          slot = s;
          break;
        }
      }
    }
    if (slot) taken[slot].push({ center, half });
    placed.push({ point, left, slot });
  }
  // Left to right, the answer last so its dot is drawn on top.
  return placed.sort((a, b) => Number(a.point.answer) - Number(b.point.answer) || a.left - b.left);
}

/**
 * Where the answer landed on a line from surprising (left) to expected (right): the answer
 * as a large orange dot named in accent, the story's words and the likeliest alternatives as
 * grey dots (B2). Positions are the engine's LandingPoint.x (log probability).
 */
export function LandingLine({ points, testID = 'landing-line' }: { points: readonly LandingPoint[]; testID?: string }) {
  const { t } = useI18n();
  const [width, setWidth] = useState(342);
  const placed = placePoints(points, width);
  const answer = points.find((p) => p.answer);
  const where = !answer ? null : answer.x >= 2 / 3 ? t('landing.where.expected') : answer.x >= 1 / 3 ? t('landing.where.middle') : t('landing.where.surprising');
  return (
    <View
      style={styles.box}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      testID={testID}
      accessible
      accessibilityLabel={answer && where ? t('landing.line.a11y', { answer: answer.text, where }) : t('landing.line.label')}
    >
      <View style={styles.axis} />
      {placed.map(({ point, left, slot }) => {
        const pct = `${(left * 100).toFixed(2)}%` as const;
        return (
          <View key={`${point.text}-${point.answer}`} style={StyleSheet.absoluteFill} pointerEvents="none" testID={`landing-point-${point.text}`}>
            <View style={[point.answer ? styles.answerDot : styles.dot, { left: pct }]} />
            {slot ? (
              <View style={[styles.labelBox, { left: pct, top: slot === 'answer' ? 10 : SLOT_TOP[slot] }]}>
                <Text
                  style={point.answer ? styles.answerLabel : styles.label}
                  numberOfLines={1}
                  maxFontSizeMultiplier={point.answer ? CONTENT_MAX_SCALE : CHROME_MAX_SCALE}
                >
                  {point.text}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}
      <Text variant="gloss" tone="muted" style={styles.legendLeft} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('heat.surprising')}
      </Text>
      <Text variant="gloss" tone="muted" style={styles.legendRight} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('heat.expected')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: 128, position: 'relative' },
  axis: { position: 'absolute', left: 0, right: 0, top: 57, height: 2, backgroundColor: colors.borderDashed },
  dot: { position: 'absolute', top: 52, width: 12, height: 12, marginLeft: -6, borderRadius: 6, backgroundColor: colors.dot },
  answerDot: { position: 'absolute', top: 48, width: 20, height: 20, marginLeft: -10, borderRadius: 10, backgroundColor: colors.live },
  labelBox: { position: 'absolute', width: LABEL_BOX, marginLeft: -LABEL_BOX / 2, alignItems: 'center' },
  label: { fontFamily: fontFamilies.interface, fontSize: 14, lineHeight: 18, color: colors.muted },
  answerLabel: { fontFamily: fontFamilies.contentSemiBold, fontSize: 20, lineHeight: 26, color: colors.accentText },
  legendLeft: { position: 'absolute', left: 0, top: 110 },
  legendRight: { position: 'absolute', right: 0, top: 110 },
});
