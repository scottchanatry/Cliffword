import { Text } from 'react-native';
import { renderHook, screen } from '@testing-library/react-native';
import { renderWithProviders } from '../testing/renderWithProviders';
import { createTestServices } from './testServices';
import { ServicesProvider, useServices } from './ServicesProvider';

function SpeechKind() {
  const { speechIn } = useServices();
  return <Text>{speechIn.kind}</Text>;
}

describe('ServicesProvider', () => {
  it('gives components the container it holds', async () => {
    const services = createTestServices();
    const { result } = await renderHook(() => useServices(), {
      wrapper: ({ children }) => <ServicesProvider services={services}>{children}</ServicesProvider>,
    });
    expect(result.current).toBe(services);
  });

  it('throws outside a provider', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderHook(() => useServices())).rejects.toThrow(/inside <ServicesProvider>/);
  });

  it('is part of AppProviders: renderWithProviders uses test services and returns them', async () => {
    const { services } = await renderWithProviders(<SpeechKind />);
    expect(screen.getByText('fake')).toBeOnTheScreen();
    expect(services.platform).toBe('test');
    expect(services.speechOut.calls).toEqual([]);
  });
});
