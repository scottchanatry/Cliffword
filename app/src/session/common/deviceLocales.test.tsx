/**
 * The device's locales reach both session controllers: useStoryController and
 * useLyricController read them from expo-localization's getLocales() (the jest-expo mock, here
 * wrapped so a test can give the phone another language) and pass them as deps.deviceLocales,
 * so a phone set to Argentine Spanish adds es-AR to the recognizer's locales.
 */
import { act, waitFor } from '@testing-library/react-native';
import { getLocales, type Locale } from 'expo-localization';
import { createTestServices, type TestServices } from '../../services/testServices';
import { renderWithAppState } from '../../testing/renderWithAppState';
import { createLyricController } from '../lyric/createLyricController';
import { useLyricController } from '../lyric/useLyricController';
import { createStoryController } from '../story/createStoryController';
import { useStoryController, type UseStoryController } from '../story/useStoryController';
import { deviceLocales } from './deviceLocales';

jest.mock('expo-localization', () => {
  const actual = jest.requireActual<typeof import('expo-localization')>('expo-localization');
  return { ...actual, getLocales: jest.fn(actual.getLocales) };
});
jest.mock('../story/createStoryController', () => {
  const actual = jest.requireActual<typeof import('../story/createStoryController')>('../story/createStoryController');
  return { ...actual, createStoryController: jest.fn(actual.createStoryController) };
});
jest.mock('../lyric/createLyricController', () => {
  const actual = jest.requireActual<typeof import('../lyric/createLyricController')>('../lyric/createLyricController');
  return { ...actual, createLyricController: jest.fn(actual.createLyricController) };
});

/** A locale as expo-localization reports it, from the jest mock's en-US with another tag. */
function locale(languageTag: string): Locale {
  const [base] = jest.requireActual<typeof import('expo-localization')>('expo-localization').getLocales();
  const [languageCode = '', regionCode = null] = languageTag.split('-');
  return { ...(base as Locale), languageTag, languageCode, regionCode, languageRegionCode: regionCode };
}

const ARGENTINA: [Locale, ...Locale[]] = [locale('es-AR'), locale('en-US')];

beforeEach(() => {
  // The jest-expo mock (one locale, en-US) unless a test sets another.
  jest.mocked(getLocales).mockReset().mockImplementation(jest.requireActual<typeof import('expo-localization')>('expo-localization').getLocales);
  jest.mocked(createStoryController).mockClear();
  jest.mocked(createLyricController).mockClear();
});

describe('deviceLocales', () => {
  it("reads the jest-expo mock's locale", () => {
    expect(deviceLocales()).toEqual(['en-US']);
    expect(getLocales).toHaveBeenCalled();
  });

  it('keeps the order, and is empty when the platform reports nothing usable', () => {
    jest.mocked(getLocales).mockReturnValueOnce(ARGENTINA);
    expect(deviceLocales()).toEqual(['es-AR', 'en-US']);
    jest.mocked(getLocales).mockImplementationOnce(() => {
      throw new Error('no locales');
    });
    expect(deviceLocales()).toEqual([]);
  });
});

describe('the controller hooks', () => {
  it('useStoryController passes them on: holding to speak listens with es-AR among the locales', async () => {
    jest.mocked(getLocales).mockReturnValue(ARGENTINA);
    const services = createTestServices() as unknown as TestServices;
    const seen: UseStoryController[] = [];
    function Probe() {
      seen.push(useStoryController());
      return null;
    }
    const { unmount } = await renderWithAppState(<Probe />, { services, settings: { onboarded: true, startLevel: 'brandNew', regions: ['PR'] } });
    const last = () => seen[seen.length - 1] as UseStoryController;
    await waitFor(() => expect(last().vm.screen?.kind).toBe('cliff'));
    const deps = jest.mocked(createStoryController).mock.calls[0]?.[0];
    expect(deps?.deviceLocales).toEqual(['es-AR', 'en-US']);
    // The same hook offers "Report this sentence" with the app's version and platform.
    expect(deps?.openUrl).toEqual(expect.any(Function));
    expect(deps?.appInfo?.platform).toMatch(/^ios/);
    expect(last().actions.reportSentence).toEqual(expect.any(Function));

    await act(async () => {
      last().actions.holdBegin();
      last().actions.holdStart();
    });
    await waitFor(() => expect(services.speechIn.startCalls).toHaveLength(1));
    const options = services.speechIn.startCalls[0];
    // The learner's region first (Puerto Rico: es-PR, es-US), then the phone's own Spanish.
    expect(options?.lang).toBe('es-PR');
    expect(options?.langFallbacks?.slice(0, 2)).toEqual(['es-US', 'es-AR']);
    unmount();
    await services.storage.close();
  });

  it('useLyricController passes them on', async () => {
    jest.mocked(getLocales).mockReturnValue(ARGENTINA);
    const services = createTestServices() as unknown as TestServices;
    function Probe() {
      useLyricController({ kind: 'text', textId: 'missing' });
      return null;
    }
    const { unmount } = await renderWithAppState(<Probe />, { services, settings: { onboarded: true } });
    await waitFor(() => expect(createLyricController).toHaveBeenCalled());
    expect(jest.mocked(createLyricController).mock.calls[0]?.[0].deviceLocales).toEqual(['es-AR', 'en-US']);
    unmount();
    await services.storage.close();
  });
});
