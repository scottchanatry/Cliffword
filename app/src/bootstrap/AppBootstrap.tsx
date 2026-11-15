/**
 * Runs startup once (bootstrap: storage open, settings read, learner restored) and renders its
 * children inside AppStateProvider when it is done. Until then it shows a loading state; if
 * startup fails it shows what went wrong with a Try again button (storage can be reopened).
 * Must be inside AppProviders (it reads the services and i18n).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppStateProvider } from '../appState/AppStateProvider';
import { useI18n } from '../i18n';
import { useServices } from '../services/ServicesProvider';
import { SchemaTooNewError } from '../storage/migrate';
import { colors, spacing } from '../theme';
import { Button, ContentText, InterfaceText, Screen } from '../ui';
import { bootstrap, type BootResult } from './bootstrap';

type Phase = { name: 'loading' } | { name: 'error'; error: unknown } | { name: 'ready'; boot: BootResult; run: number };

export interface AppBootstrapProps {
  children: ReactNode;
  /** Called once startup has finished, successfully or not (the root layout hides the splash). */
  onSettled?: () => void;
}

export function AppBootstrap({ children, onSettled }: AppBootstrapProps) {
  const services = useServices();
  const [run, setRun] = useState(0);
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });

  useEffect(() => {
    let current = true;
    bootstrap(services).then(
      (boot) => {
        if (current) setPhase({ name: 'ready', boot, run });
      },
      (error: unknown) => {
        if (!current) return;
        if (__DEV__) console.warn('[bootstrap] startup failed', error);
        setPhase({ name: 'error', error });
      },
    );
    return () => {
      current = false;
    };
  }, [services, run]);

  const settled = phase.name !== 'loading';
  useEffect(() => {
    if (settled) onSettled?.();
  }, [settled, onSettled]);

  if (phase.name === 'loading') return <BootLoading />;
  if (phase.name === 'error') {
    const retry = () => {
      setPhase({ name: 'loading' });
      setRun((n) => n + 1);
    };
    return <BootError error={phase.error} onRetry={retry} />;
  }
  return (
    <AppStateProvider key={phase.run} boot={phase.boot} packs={services.packs}>
      {children}
    </AppStateProvider>
  );
}

function BootLoading() {
  const { t } = useI18n();
  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} contentStyle={styles.center} testID="boot-loading">
      <View accessible accessibilityRole="progressbar" accessibilityLabel={t('boot.loading')} style={styles.center}>
        <ActivityIndicator color={colors.ink} size="large" />
        <InterfaceText tone="muted">{t('boot.loading')}</InterfaceText>
      </View>
    </Screen>
  );
}

function BootError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  const tooNew = error instanceof SchemaTooNewError;
  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} contentStyle={styles.center} testID="boot-error">
      <ContentText variant="title" accessibilityRole="header">
        {t('boot.error.title')}
      </ContentText>
      <InterfaceText tone="muted">{tooNew ? t('boot.error.tooNew') : t('boot.error.body')}</InterfaceText>
      {tooNew ? null : <Button label={t('common.retry')} onPress={onRetry} testID="boot-retry" />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg },
});
