import { act } from '@testing-library/react-native';
import { FakeModelManager } from '../../adapters/model/FakeModelManager';
import { FixedNetworkInfo } from '../../adapters/network/FixedNetworkInfo';
import { createTestServices } from '../../services/testServices';
import { ONBOARDED } from '../../storage/repos/settings';
import { renderWithAppState } from '../../testing/renderWithAppState';
import { useModelAutoDownload } from './useModelAutoDownload';

function Probe() {
  useModelAutoDownload();
  return null;
}

async function setup(settings: Record<string, unknown>, network: FixedNetworkInfo) {
  const modelManager = new FakeModelManager({ initial: 'absent', mode: 'manual' });
  const services = createTestServices({ modelManager, network });
  const { unmount } = await renderWithAppState(<Probe />, { services, settings });
  return { modelManager, services, unmount };
}

describe('useModelAutoDownload', () => {
  it('waits for Wi-Fi after onboarding, then starts once', async () => {
    const network = new FixedNetworkInfo('cellular');
    const { modelManager, unmount, services } = await setup({ ...ONBOARDED }, network);
    expect(modelManager.downloadsStarted).toBe(0);
    await act(async () => network.set('wifi'));
    expect(modelManager.downloadsStarted).toBe(1);
    await act(async () => network.set('cellular'));
    await act(async () => network.set('wifi'));
    expect(modelManager.downloadsStarted).toBe(1);
    unmount();
    await services.storage.close();
  });

  it('downloads nothing before onboarding is done, or after "Not now"', async () => {
    const first = await setup({}, new FixedNetworkInfo('wifi'));
    expect(first.modelManager.downloadsStarted).toBe(0);
    first.unmount();
    await first.services.storage.close();
    const declined = await setup({ ...ONBOARDED, modelDeclined: true }, new FixedNetworkInfo('wifi'));
    expect(declined.modelManager.downloadsStarted).toBe(0);
    declined.unmount();
    await declined.services.storage.close();
  });
});
