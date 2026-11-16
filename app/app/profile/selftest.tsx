import { useRouter } from 'expo-router';
import { SelfTestView } from '../../src/features/profile/SelfTestView';
import { useSelfTest } from '../../src/features/profile/useSelfTest';

/** The hidden model self-test (seven taps on the version in Settings). */
export default function SelfTestScreen() {
  const router = useRouter();
  const test = useSelfTest();
  return <SelfTestView {...test} onBack={() => router.back()} />;
}
