import { StyleSheet, View } from 'react-native';
import { tKey, useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { Pill } from '../../ui';

/** Region codes with a slang pack in the engine (REGION_CODES minus the shared CARIB pack). */
export const REGION_PILLS = [
  { code: 'PR', label: tKey('region.pill.PR') },
  { code: 'DO', label: tKey('region.pill.DO') },
  { code: 'CU', label: tKey('region.pill.CU') },
  { code: 'CO', label: tKey('region.pill.CO') },
] as const;

export type RegionCode = (typeof REGION_PILLS)[number]['code'];

export interface RegionPillsProps {
  /** Selected region codes (settings.regions; codes without a pill, such as CARIB, are ignored). */
  selected: readonly string[];
  onToggle: (code: RegionCode) => void;
}

/** "Slang I want to learn": one toggle pill per region. */
export function RegionPills({ selected, onToggle }: RegionPillsProps) {
  const { t } = useI18n();
  return (
    <View style={styles.wrap}>
      {REGION_PILLS.map(({ code, label }) => (
        <Pill
          key={code}
          variant="strong"
          label={t(label)}
          selected={selected.includes(code)}
          onPress={() => onToggle(code)}
          testID={`region-${code}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
