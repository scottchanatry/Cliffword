import { StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { clockParts, tKey, useI18n, type CatalogKey } from '../../i18n';
import { colors, radii, spacing } from '../../theme';
import { Card, ContentText, InterfaceText } from '../../ui';
import { weekTotal, type WeekBar } from './stats';

/** Short and spoken weekday names, Sunday first (weekday 0). */
const WEEKDAY_SHORT: readonly CatalogKey[] = [
  tKey('weekday.short.0'),
  tKey('weekday.short.1'),
  tKey('weekday.short.2'),
  tKey('weekday.short.3'),
  tKey('weekday.short.4'),
  tKey('weekday.short.5'),
  tKey('weekday.short.6'),
];
const WEEKDAY_LONG: readonly CatalogKey[] = [
  tKey('weekday.long.0'),
  tKey('weekday.long.1'),
  tKey('weekday.long.2'),
  tKey('weekday.long.3'),
  tKey('weekday.long.4'),
  tKey('weekday.long.5'),
  tKey('weekday.long.6'),
];

export interface MinutesHeadlineProps {
  todayMs: number;
  totalMs: number;
  week: readonly WeekBar[];
  streakDays: number;
}

/** Bar area height; a day without speaking keeps a stub so the week reads as seven days. */
const BAR_MAX = 76;
const BAR_STUB = 4;

/**
 * The headline metric: minutes spoken today in the display face, the last seven days as bars
 * (today in amber), and the week, the total and the streak below.
 */
export function MinutesHeadline({ todayMs, totalMs, week, streakDays }: MinutesHeadlineProps) {
  const { t, plural } = useI18n();
  const clock = (ms: number) => t('time.clock', clockParts(ms));
  const weekMs = weekTotal(week);
  const days = week.map((b) => t('profile.week.day', { day: t(WEEKDAY_LONG[b.weekday] ?? WEEKDAY_LONG[0]!), time: clock(b.ms) }));
  return (
    <Card testID="minutes-headline">
      <InterfaceText variant="eyebrow" tone="muted" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('stats.minutesSpoken')}
      </InterfaceText>
      <View style={styles.today}>
        <ContentText variant="display" tone="accent" maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="minutes-today">
          {clock(todayMs)}
        </ContentText>
        <InterfaceText variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('profile.today')}
        </InterfaceText>
      </View>
      <View
        accessible
        accessibilityLabel={t('profile.week.a11y', { days: days.join(t('profile.week.join')) })}
        style={styles.chart}
        testID="week-bars"
      >
        {week.map((bar) => (
          <View key={bar.day} style={styles.column}>
            <View style={styles.barArea}>
              <View
                style={[
                  styles.bar,
                  { height: bar.ms > 0 ? Math.max(BAR_STUB * 2, Math.round(bar.share * BAR_MAX)) : BAR_STUB },
                  bar.ms > 0 ? (bar.today ? styles.barToday : styles.barDay) : styles.barEmpty,
                ]}
                testID={`week-bar-${bar.day}`}
              />
            </View>
            <InterfaceText variant="gloss" tone={bar.today ? 'ink' : 'muted'} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {t(WEEKDAY_SHORT[bar.weekday] ?? WEEKDAY_SHORT[0]!)}
            </InterfaceText>
          </View>
        ))}
      </View>
      <View style={styles.stats}>
        <Stat label={t('profile.thisWeek')} value={clock(weekMs)} testID="minutes-week" />
        <Stat label={t('profile.total')} value={clock(totalMs)} testID="minutes-total" />
        <Stat label={t('profile.streak')} value={plural('profile.streak.days', streakDays)} testID="streak" />
      </View>
    </Card>
  );
}

function Stat({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={styles.stat}>
      <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {label}
      </InterfaceText>
      <ContentText variant="contentTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={testID}>
        {value}
      </ContentText>
    </View>
  );
}

const styles = StyleSheet.create({
  today: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  chart: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs },
  column: { flex: 1, alignItems: 'center', gap: spacing.xs },
  barArea: { height: BAR_MAX, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: radii.tile },
  barDay: { backgroundColor: colors.tileMid },
  barToday: { backgroundColor: colors.heat3 },
  barEmpty: { backgroundColor: colors.borderSoft },
  stats: { flexDirection: 'row', gap: spacing.md, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  stat: { flex: 1, gap: spacing.xxs, paddingTop: spacing.sm },
});
