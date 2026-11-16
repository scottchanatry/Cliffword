import { act, waitFor } from '@testing-library/react-native';
import type { LearnerModel } from '@cliffword/engine';
import { useLearner } from '../../appState/AppStateProvider';
import { MockModelAdapter } from '../../adapters/model/MockModelAdapter';
import { sharedMockModel } from '../../services/defaults';
import { createTestServices, type TestServices } from '../../services/testServices';
import { renderWithAppState } from '../../testing/renderWithAppState';
import type { StoryActions, StoryViewModel } from '../contract';
import { useStoryController } from './useStoryController';

interface Seen {
  vm: StoryViewModel;
  actions: StoryActions;
  learner: LearnerModel;
}

function Probe({ seen }: { seen: Seen[] }) {
  const { vm, actions } = useStoryController();
  const learner = useLearner();
  seen.push({ vm, actions, learner });
  return null;
}

describe('useStoryController', () => {
  it('starts the story, hands the rebuilt learner to the app state and keeps the same controller', async () => {
    const services = createTestServices({ model: new MockModelAdapter({ model: sharedMockModel(), status: 'unloaded' }) }) as unknown as TestServices;
    const seen: Seen[] = [];
    const { boot, unmount } = await renderWithAppState(<Probe seen={seen} />, { services, settings: { onboarded: true, startLevel: 'brandNew' } });
    const last = () => seen[seen.length - 1] as Seen;
    expect(seen[0]?.vm.screen).toBeNull();
    await waitFor(() => expect(last().vm.screen?.kind).toBe('cliff'));
    // Brand new: the session rebuilt the learner with its prior; the app state now holds it.
    expect(last().learner).not.toBe(boot.learner.learner);
    const natural = last().vm.screen?.kind === 'cliff' ? (last().vm.screen as Extract<StoryViewModel['screen'], { kind: 'cliff' }>).cliff.options?.find((o) => o.text === 'artista')?.index : undefined;
    await act(async () => last().actions.pickOption(natural ?? -1));
    await waitFor(() => expect(last().vm.screen?.kind).toBe('landing'));
    // The events went to the learner every screen reads.
    expect(last().learner.memoryOf('es:artista', 'meaning')).toBeDefined();
    // One controller, one session: the hand-over did not restart the story.
    const storage = await services.storage.open();
    expect(await storage.sessions.list({ kind: 'story' })).toHaveLength(1);
    expect(services.speechOut.spokenTexts.filter((t) => t === 'Marta es una')).toHaveLength(1);
    unmount();
    await services.storage.close();
  });
});
