import { StyleSheet, View } from 'react-native';
import type { ModelBackend, ModelInfo, ModelScoringPath, ModelStatus } from '../../adapters/model/types';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { tKey, useI18n, type CatalogKey } from '../../i18n';
import { colors, spacing } from '../../theme';
import { Button, Card, ContentText, InterfaceText, Screen } from '../../ui';
import { ModalHeader } from './ModalHeader';
import type { SelfTestReport, SentenceResult } from './selftest';
import { SELF_TEST_CONTEXT, SELF_TEST_PAIRS, SELF_TEST_TOLERANCE } from './selftestData';

const SCORING_LABELS: Readonly<Record<ModelScoringPath, CatalogKey>> = {
  native: tKey('selftest.scoring.native'),
  'forced-decoding': tKey('selftest.scoring.forced'),
  exact: tKey('selftest.scoring.exact'),
};

const BACKEND_LABELS: Readonly<Record<ModelBackend, CatalogKey>> = {
  mock: tKey('selftest.backend.mock'),
  'llama.rn': tKey('selftest.backend.llama'),
  http: tKey('selftest.backend.http'),
};

const STATUS_LABELS: Readonly<Record<ModelStatus, CatalogKey>> = {
  unloaded: tKey('selftest.status.unloaded'),
  loading: tKey('selftest.status.loading'),
  ready: tKey('selftest.status.ready'),
  error: tKey('selftest.status.error'),
};

const VERDICT_KEYS: Readonly<Record<SelfTestReport['verdict'], CatalogKey>> = {
  pass: tKey('selftest.verdict.pass'),
  fail: tKey('selftest.verdict.fail'),
  mock: tKey('selftest.verdict.mock'),
};

export interface SelfTestViewProps {
  info: ModelInfo;
  status: ModelStatus;
  report: SelfTestReport | null;
  /** Sentences scored so far while running, else null. */
  progress: { done: number; total: number } | null;
  onRun: () => void;
  onBack: () => void;
}

const nats = (n: number) => n.toFixed(2);

/** The hidden model self-test: what runs, a run button, the verdict and every sentence's numbers. */
export function SelfTestView({ info, status, report, progress, onRun, onBack }: SelfTestViewProps) {
  const { t, plural } = useI18n();
  const scoring = info.scoring ?? 'exact';
  const ready = status === 'ready';
  const running = progress !== null;
  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']} testID="selftest-screen">
      <ModalHeader title={t('selftest.title')} actionLabel={t('common.back')} onAction={onBack} placement="leading" actionTestID="selftest-back" />
      <InterfaceText variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('selftest.body', {
          count: SELF_TEST_PAIRS.length * 2,
          context: JSON.stringify(SELF_TEST_CONTEXT),
          tolerance: nats(SELF_TEST_TOLERANCE),
        })}
      </InterfaceText>
      <Card style={styles.info}>
        <Info label={t('selftest.model')} value={info.id} testID="selftest-model" />
        <Info label={t('selftest.backend')} value={t(BACKEND_LABELS[info.backend])} testID="selftest-backend" />
        <Info label={t('selftest.scoring')} value={t(SCORING_LABELS[scoring])} testID="selftest-scoring" />
        <Info label={t('selftest.status')} value={t(STATUS_LABELS[status])} testID="selftest-status" last />
      </Card>
      {ready ? null : (
        <InterfaceText variant="body" tone="accent" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="selftest-not-ready">
          {t('selftest.notReady')}
        </InterfaceText>
      )}
      <Button
        label={running ? t('selftest.running', { done: progress.done, total: progress.total }) : report ? t('selftest.runAgain') : t('selftest.run')}
        onPress={onRun}
        disabled={!ready || running}
        testID="selftest-run"
      />
      {report ? (
        <>
          <Card testID="selftest-verdict">
            <InterfaceText variant="cardTitle" tone={report.verdict === 'fail' ? 'accent' : 'ink'} accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="selftest-verdict-title">
              {t(VERDICT_KEYS[report.verdict], {
                within: report.within,
                count: report.sentences,
                tolerance: nats(report.tolerance),
                max: nats(report.maxDiff),
              })}
            </InterfaceText>
            <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {t('selftest.order', { n: report.preferred, m: report.scoredPairs })}
            </InterfaceText>
            <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {t('selftest.timing', { ms: Math.round(report.totalMs), avg: Math.round(report.totalMs / Math.max(1, report.sentences)) })}
            </InterfaceText>
            {report.failedCalls > 0 ? (
              <InterfaceText variant="body" tone="accent" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {plural('selftest.failedCalls', report.failedCalls)}
              </InterfaceText>
            ) : null}
            {report.scoring === 'forced-decoding' ? (
              <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {t('selftest.forcedNote')}
              </InterfaceText>
            ) : null}
          </Card>
          {report.pairs.map(({ pair, good, bad }) => (
            <Card key={pair.id} testID={`selftest-pair-${pair.id}`}>
              <InterfaceText variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {t('selftest.pairLabel', { id: pair.id, rule: pair.rule })}
              </InterfaceText>
              <SentenceRow result={good} tolerance={report.tolerance} mock={report.verdict === 'mock'} />
              <SentenceRow result={bad} tolerance={report.tolerance} mock={report.verdict === 'mock'} />
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function Info({ label, value, testID, last }: { label: string; value: string; testID: string; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.divider]}>
      <InterfaceText variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {label}
      </InterfaceText>
      <InterfaceText variant="bodyStrong" style={styles.infoValue} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={testID}>
        {value}
      </InterfaceText>
    </View>
  );
}

function SentenceRow({ result, tolerance, mock }: { result: SentenceResult; tolerance: number; mock: boolean }) {
  const { t } = useI18n();
  const off = !mock && (result.diff === null || result.diff > tolerance);
  const numbers =
    result.actual === null
      ? t('selftest.row.failed', { expected: nats(result.expected), error: result.error ?? '' })
      : t(mock ? tKey('selftest.row.mock') : tKey('selftest.row'), {
          actual: nats(result.actual),
          expected: nats(result.expected),
          diff: nats(result.diff ?? 0),
          ms: Math.round(result.ms),
        });
  return (
    <View style={styles.sentence}>
      <ContentText variant="prompt" style={styles.sentenceText} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {result.text}
      </ContentText>
      <InterfaceText variant="caption" tone={off ? 'accent' : 'muted'} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {numbers}
      </InterfaceText>
      {result.upperBound > 0 ? (
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('selftest.upperBounds', { n: result.upperBound, tokens: result.tokens })}
        </InterfaceText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  info: { paddingVertical: spacing.xs, gap: 0 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.md },
  infoValue: { flexShrink: 1, textAlign: 'right' },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  sentence: { gap: spacing.xxs },
  sentenceText: { fontSize: 19, lineHeight: 26 },
});
