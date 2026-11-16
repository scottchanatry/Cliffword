import { useRouter } from 'expo-router';
import { LicensesView } from '../../src/features/profile/LicensesView';

/** The licenses of the model, the runtime, the fonts and the frameworks. */
export default function LicensesScreen() {
  const router = useRouter();
  return <LicensesView onBack={() => router.back()} />;
}
