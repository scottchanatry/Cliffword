import { Text } from 'react-native';
import { act, screen } from '@testing-library/react-native';
import { frequencyLexemeKeys } from '@cliffword/engine';
import { createTestServices } from '../../services/testServices';
import { renderWithAppState } from '../../testing/renderWithAppState';
import { useProfileStats } from './useProfileStats';

function Stats() {
  const { spokenMs, wordsKnown } = useProfileStats();
  return <Text testID="stats">{`${spokenMs}|${wordsKnown}`}</Text>;
}

const read = () => {
  const [spoken, words] = String(screen.getByTestId('stats').props.children).split('|').map(Number);
  return { spoken: spoken ?? NaN, words: words ?? NaN };
};

describe('useProfileStats', () => {
  it('reads total minutes spoken from storage', async () => {
    const services = createTestServices();
    const storage = await services.storage.open();
    await storage.spokenTime.addUtterance(90_000, services.clock.now());
    await storage.spokenTime.addUtterance(30_000, services.clock.now() - 86_400_000);
    await renderWithAppState(<Stats />, { services });
    await screen.findByText(/^120000\|/);
    await services.storage.close();
  });

  it("estimates the learner's vocabulary, which grows as words are learned", async () => {
    const { services, boot, rerender } = await renderWithAppState(<Stats />, { settings: { onboarded: true } });
    const before = read().words;
    // A brand-new learner probably understands the cognates already.
    expect(before).toBeGreaterThan(0);
    const learned = frequencyLexemeKeys(services.packs.lang).slice(0, 40);
    await act(async () => {
      await boot.storage.learner.record(
        boot.learner.learner,
        learned.map((key) => ({ type: 'marked_known' as const, key, at: services.clock.now() })),
      );
    });
    // The estimate is memoized per learner; a new mount reads the changed model.
    await rerender(<Text />);
    await rerender(<Stats />);
    expect(read().words).toBeGreaterThan(before);
    await services.storage.close();
  });
});
