import { Text } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { useAppState } from '../appState/AppStateProvider';
import { createTestServices } from '../services/testServices';
import { SchemaTooNewError } from '../storage/migrate';
import { useStorage } from '../storage/StorageProvider';
import { renderWithProviders } from '../testing/renderWithProviders';
import { AppBootstrap } from './AppBootstrap';

function Ready() {
  const { settings, learner } = useAppState();
  const storage = useStorage();
  return (
    <Text testID="ready">
      {`onboarded=${settings.onboarded} learner=${learner.constructor.name} storage=${typeof storage.settings.get}`}
    </Text>
  );
}

describe('AppBootstrap', () => {
  it('shows the loading state, then renders its children with storage, settings and the learner', async () => {
    const onSettled = jest.fn();
    const services = createTestServices();
    const realOpen = services.storage.open;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest.spyOn(services.storage, 'open').mockImplementation(() => gate.then(realOpen));
    await renderWithProviders(
      <AppBootstrap onSettled={onSettled}>
        <Ready />
      </AppBootstrap>,
      { services },
    );
    expect(screen.getByTestId('boot-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('ready')).toBeNull();
    expect(onSettled).not.toHaveBeenCalled();
    await act(async () => release());
    expect(await screen.findByTestId('ready')).toHaveTextContent('onboarded=false learner=LearnerModel storage=function');
    expect(screen.queryByTestId('boot-loading')).toBeNull();
    expect(onSettled).toHaveBeenCalledTimes(1);
    await services.storage.close();
  });

  it('announces the loading state to screen readers', async () => {
    const services = createTestServices();
    jest.spyOn(services.storage, 'open').mockReturnValue(new Promise(() => undefined));
    const onSettled = jest.fn();
    await renderWithProviders(
      <AppBootstrap onSettled={onSettled}>
        <Ready />
      </AppBootstrap>,
      { services },
    );
    expect(screen.getByRole('progressbar', { name: 'Getting your story ready…' })).toBeOnTheScreen();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('shows an error with Try again, and starts on the retry', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const services = createTestServices();
    const realOpen = services.storage.open;
    jest.spyOn(services.storage, 'open').mockRejectedValueOnce(new Error('locked')).mockImplementation(realOpen);
    const onSettled = jest.fn();
    await renderWithProviders(
      <AppBootstrap onSettled={onSettled}>
        <Ready />
      </AppBootstrap>,
      { services },
    );
    expect(await screen.findByText('Your saved progress could not be opened. Try again.')).toBeOnTheScreen();
    expect(onSettled).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('ready')).toBeOnTheScreen();
    warn.mockRestore();
    await services.storage.close();
  });

  it('asks for an app update, without a retry, when the data is from a newer app', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const services = createTestServices();
    jest.spyOn(services.storage, 'open').mockRejectedValue(new SchemaTooNewError(9, 2));
    await renderWithProviders(
      <AppBootstrap>
        <Ready />
      </AppBootstrap>,
      { services },
    );
    expect(await screen.findByText(/saved by a newer version of Cliffword/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    warn.mockRestore();
  });
});
