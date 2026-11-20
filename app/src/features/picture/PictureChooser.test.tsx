/**
 * The learner's picture chooser: the view (the picture on top, nine named characters with the
 * chosen one ringed, the photo buttons, Remove photo, the notices; named 44 pt controls) and the
 * behaviour behind it (usePictureChooser over the app state and a FakePhotoPicker): every choice is
 * stored at once, a replaced or removed photo is deleted, a cancel changes nothing, a refusal or an
 * error says so and keeps the picture.
 */
import { Dimensions, StyleSheet, Text } from 'react-native';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useAppState } from '../../appState/AppStateProvider';
import { YOU_AVATAR_IDS, YOU_AVATARS } from '../../illustrations';
import { createTestServices } from '../../services/testServices';
import { renderWithAppState } from '../../testing/renderWithAppState';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { DEFAULT_PICTURE, type LearnerPicture } from '../../storage/repos/settings';
import { colors, layout } from '../../theme';
import { CHARACTER_SIZE, COMPACT, PictureChooser, PREVIEW_SIZE, type PictureChooserProps } from './PictureChooser';
import { usePictureChooser } from './usePictureChooser';

const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;
const hidden = { includeHiddenElements: true };

function props(overrides: Partial<PictureChooserProps> = {}): PictureChooserProps {
  return {
    picture: DEFAULT_PICTURE,
    sources: ['camera', 'library'],
    busy: false,
    notice: null,
    onChooseCharacter: jest.fn(),
    onPickPhoto: jest.fn(),
    onRemovePhoto: jest.fn(),
    onOpenSettings: jest.fn(),
    ...overrides,
  };
}

async function renderView(p: PictureChooserProps) {
  await renderWithProviders(<PictureChooser {...p} />);
  return p;
}

function expectAccessibleControls() {
  const controls = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('radio')];
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    const name: unknown = control.props.accessibilityLabel ?? within(control).queryAllByText(/\S/)[0]?.props.children;
    expect({ testID: control.props.testID, named: typeof name === 'string' && name.trim().length > 0 }).toEqual({ testID: control.props.testID, named: true });
    const style = flat(control.props.style);
    const size = Math.max(Number(style.minHeight ?? 0), Number(style.height ?? 0));
    expect({ testID: control.props.testID, size: size >= layout.minTouch }).toEqual({ testID: control.props.testID, size: true });
  }
}

describe('PictureChooser (view)', () => {
  it('shows the picture large on top and the nine characters as named radios, the chosen one ringed', async () => {
    const p = await renderView(props({ picture: { kind: 'character', id: 'you-grandma' } }));
    expect(screen.getByTestId('picture-preview').props.accessibilityLabel).toBe('Your picture: Grandma in sunglasses with a fan');
    const preview = screen.getByTestId('picture-preview-image', hidden);
    expect(preview.props.source).toBe(YOU_AVATARS['you-grandma']);
    expect(flat(preview.props.style)).toMatchObject({ width: PREVIEW_SIZE, height: PREVIEW_SIZE });

    expect(screen.getByTestId('picture-characters').props.accessibilityRole).toBe('radiogroup');
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.props.testID)).toEqual(YOU_AVATAR_IDS.map((id) => `picture-character-${id}`));
    expect(radios.map((r) => r.props.accessibilityLabel)).toEqual([
      'Smiling person waving hello',
      'Teenager with headphones and a skateboard',
      'Backpacker with a map',
      'Remote worker with a laptop and a big coffee',
      'Chef with a wooden spoon',
      'Photographer with a camera',
      'Older musician with a guitar',
      'Grandma in sunglasses with a fan',
      'Old sea captain with a toy sailboat',
    ]);
    const checked = radios.filter((r) => r.props.accessibilityState?.checked);
    expect(checked.map((r) => r.props.testID)).toEqual(['picture-character-you-grandma']);
    expect(checked[0]?.props.accessibilityState).toMatchObject({ selected: true });
    // The ring: ink around the chosen one, none around the others; each circle about 88 pt.
    expect(flat(screen.getByTestId('picture-character-you-grandma').props.style).borderColor).toBe(colors.ink);
    expect(flat(screen.getByTestId('picture-character-you').props.style).borderColor).toBe('transparent');
    expect(CHARACTER_SIZE).toBe(88);
    expect(flat(screen.getByTestId('picture-character-you-image', hidden).props.style)).toMatchObject({ width: 88, height: 88 });
    // Three columns.
    const cell = screen.getByTestId('picture-character-you').parent;
    expect(flat(cell?.props.style).width).toBe('33.333%');
    expectAccessibleControls();

    await fireEvent.press(screen.getByTestId('picture-character-you-chef'));
    expect(p.onChooseCharacter).toHaveBeenCalledWith('you-chef');
  });

  it('is a little smaller on a short screen (375 x 667), so Continue shows below it', async () => {
    const before = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
    const se = { width: 375, height: 667, scale: 2, fontScale: 1 };
    Dimensions.set({ window: se, screen: se });
    try {
      await renderView(props());
      expect(flat(screen.getByTestId('picture-character-you-image', hidden).props.style)).toMatchObject({ width: COMPACT.character, height: COMPACT.character });
      expect(flat(screen.getByTestId('picture-preview-image', hidden).props.style)).toMatchObject({ width: COMPACT.preview });
      // Still a 44 pt target and still three columns.
      expectAccessibleControls();
      expect(flat(screen.getByTestId('picture-character-you').parent?.props.style).width).toBe('33.333%');
    } finally {
      Dimensions.set(before);
    }
  });

  it('offers a selfie and a photo, and says the photo stays on the phone', async () => {
    const p = await renderView(props());
    expect(screen.getByTestId('picture-camera')).toHaveTextContent('Take a selfie');
    expect(screen.getByTestId('picture-library')).toHaveTextContent('Choose a photo');
    expect(screen.getByText('Your photo stays on this phone. It is never uploaded.')).toBeOnTheScreen();
    // No photo yet: nothing to remove.
    expect(screen.queryByTestId('picture-remove')).toBeNull();
    await fireEvent.press(screen.getByTestId('picture-camera'));
    await fireEvent.press(screen.getByTestId('picture-library'));
    expect(p.onPickPhoto).toHaveBeenNthCalledWith(1, 'camera');
    expect(p.onPickPhoto).toHaveBeenNthCalledWith(2, 'library');
  });

  it('shows a photo as a circle, no character ringed, and offers Remove photo', async () => {
    const uri = 'file:///docs/avatar/1.jpg';
    const p = await renderView(props({ picture: { kind: 'photo', uri } }));
    expect(screen.getByTestId('picture-preview').props.accessibilityLabel).toBe('Your picture: Your photo');
    const preview = screen.getByTestId('picture-preview-image', hidden);
    expect(preview.props.source).toEqual({ uri });
    expect(flat(preview.props.style)).toMatchObject({ width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: PREVIEW_SIZE / 2 });
    expect(screen.getAllByRole('radio').filter((r) => r.props.accessibilityState?.checked)).toEqual([]);
    await fireEvent.press(screen.getByTestId('picture-remove'));
    expect(p.onRemovePhoto).toHaveBeenCalled();
    expectAccessibleControls();
  });

  it('shows the default character when a photo fails to load', async () => {
    await renderView(props({ picture: { kind: 'photo', uri: 'file:///docs/avatar/gone.jpg' } }));
    const preview = screen.getByTestId('picture-preview-image', hidden);
    await act(async () => preview.props.onError?.({ nativeEvent: { error: 'gone' } }));
    expect(screen.getByTestId('picture-preview-image', hidden).props.source).toBe(YOU_AVATARS.you);
  });

  it('hides the photo buttons where the device has none (the web preview)', async () => {
    await renderView(props({ sources: [] }));
    expect(screen.queryByTestId('picture-camera')).toBeNull();
    expect(screen.queryByTestId('picture-library')).toBeNull();
    expect(screen.queryByText(/never uploaded/)).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(9);
  });

  it('says how to allow the camera in Settings after a refusal, and that the picture stayed after an error', async () => {
    const p = await renderView(props({ notice: { kind: 'denied', source: 'camera' } }));
    expect(screen.getByTestId('picture-notice')).toHaveTextContent(
      'Camera access is off, so your picture stays as it is. To take a selfie, open Settings and turn on Camera for Cliffword.Open Settings',
    );
    await fireEvent.press(screen.getByTestId('picture-open-settings'));
    expect(p.onOpenSettings).toHaveBeenCalled();
    await renderView(props({ notice: { kind: 'denied', source: 'library' } }));
    expect(screen.getByTestId('picture-notice')).toHaveTextContent(/allow Photos for Cliffword/);
    await renderView(props({ notice: { kind: 'error' } }));
    expect(screen.getByTestId('picture-notice')).toHaveTextContent('That photo didn’t work, so your picture stays as it is. Try again, or pick a character.');
    expect(screen.queryByTestId('picture-open-settings')).toBeNull();
  });

  it('disables every choice while a photo is being taken', async () => {
    await renderView(props({ busy: true, picture: { kind: 'photo', uri: 'file:///docs/avatar/1.jpg' } }));
    for (const id of YOU_AVATAR_IDS) expect(screen.getByTestId(`picture-character-${id}`)).toBeDisabled();
    expect(screen.getByTestId('picture-camera')).toBeDisabled();
    expect(screen.getByTestId('picture-library')).toBeDisabled();
    expect(screen.getByTestId('picture-remove')).toBeDisabled();
  });
});

/** The chooser wired as the routes wire it, plus the stored picture as text. */
function Wired() {
  const c = usePictureChooser();
  const { settings } = useAppState();
  return (
    <>
      <PictureChooser
        picture={c.picture}
        sources={c.sources}
        busy={c.busy}
        notice={c.notice}
        onChooseCharacter={c.chooseCharacter}
        onPickPhoto={c.pickPhoto}
        onRemovePhoto={c.removePhoto}
        onOpenSettings={c.openSettings}
      />
      <Text testID="stored">{JSON.stringify(settings.picture)}</Text>
    </>
  );
}

const stored = () => JSON.parse(String(screen.getByTestId('stored').props.children)) as LearnerPicture;

describe('usePictureChooser', () => {
  it('stores a character at once', async () => {
    const { services } = await renderWithAppState(<Wired />);
    expect(stored()).toEqual(DEFAULT_PICTURE);
    await fireEvent.press(screen.getByTestId('picture-character-you-musician'));
    await waitFor(() => expect(stored()).toEqual({ kind: 'character', id: 'you-musician' }));
    expect(await (await services.storage.open()).settings.get('picture')).toEqual({ kind: 'character', id: 'you-musician' });
  });

  it('stores a selfie, deletes the photo it replaces, and deletes the photo when a character replaces it', async () => {
    const { services } = await renderWithAppState(<Wired />);
    await fireEvent.press(screen.getByTestId('picture-camera'));
    await waitFor(() => expect(stored().kind).toBe('photo'));
    const first = stored() as Extract<LearnerPicture, { kind: 'photo' }>;
    expect(services.photos.stored()).toEqual([first.uri]);

    services.clock.advance(1000);
    await fireEvent.press(screen.getByTestId('picture-library'));
    await waitFor(() => expect(stored()).not.toEqual(first));
    const second = stored() as Extract<LearnerPicture, { kind: 'photo' }>;
    expect(services.photos.removed).toEqual([first.uri]);
    expect(services.photos.stored()).toEqual([second.uri]);
    expect(services.photos.picks).toEqual(['camera', 'library']);

    await fireEvent.press(screen.getByTestId('picture-character-you-teen'));
    await waitFor(() => expect(stored()).toEqual({ kind: 'character', id: 'you-teen' }));
    expect(services.photos.stored()).toEqual([]);
    expect(services.photos.removed).toEqual([first.uri, second.uri]);
  });

  it('removes a photo: back to the default character, and the file deleted', async () => {
    const services = createTestServices();
    const uri = services.photos.store();
    await renderWithAppState(<Wired />, { services, settings: { picture: { kind: 'photo', uri } } });
    expect(stored()).toEqual({ kind: 'photo', uri });
    await fireEvent.press(screen.getByTestId('picture-remove'));
    await waitFor(() => expect(stored()).toEqual(DEFAULT_PICTURE));
    expect(services.photos.removed).toEqual([uri]);
    expect(services.photos.stored()).toEqual([]);
    expect(screen.queryByTestId('picture-remove')).toBeNull();
  });

  it('changes nothing when the learner cancels', async () => {
    const { services } = await renderWithAppState(<Wired />, { settings: { picture: { kind: 'character', id: 'you-chef' } } });
    services.photos.script('cancelled');
    await fireEvent.press(screen.getByTestId('picture-camera'));
    await waitFor(() => expect(screen.getByTestId('picture-camera')).toBeEnabled());
    expect(stored()).toEqual({ kind: 'character', id: 'you-chef' });
    expect(screen.queryByTestId('picture-notice')).toBeNull();
    expect(services.photos.stored()).toEqual([]);
  });

  it('keeps the picture and says how to allow the camera when it is refused', async () => {
    const { services } = await renderWithAppState(<Wired />, { settings: { picture: { kind: 'character', id: 'you-chef' } } });
    services.photos.script('denied');
    await fireEvent.press(screen.getByTestId('picture-camera'));
    expect(await screen.findByTestId('picture-notice')).toHaveTextContent(/Camera access is off/);
    expect(stored()).toEqual({ kind: 'character', id: 'you-chef' });
    // A new choice clears the notice.
    await fireEvent.press(screen.getByTestId('picture-character-you'));
    await waitFor(() => expect(screen.queryByTestId('picture-notice')).toBeNull());
  });

  it('reports an error and keeps the picture, and deletes a copy that could not be stored', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { services } = await renderWithAppState(<Wired />, { settings: { picture: { kind: 'character', id: 'you-chef' } } });
    services.photos.script('error');
    await fireEvent.press(screen.getByTestId('picture-library'));
    expect(await screen.findByTestId('picture-notice')).toHaveTextContent(/That photo didn’t work/);
    expect(stored()).toEqual({ kind: 'character', id: 'you-chef' });

    // A photo that was taken but could not be stored as the setting is deleted again.
    const storage = await services.storage.open();
    jest.spyOn(storage.settings, 'update').mockRejectedValueOnce(new Error('disk full'));
    await fireEvent.press(screen.getByTestId('picture-camera'));
    await waitFor(() => expect(services.photos.removed).toHaveLength(1));
    expect(services.photos.stored()).toEqual([]);
    expect(await screen.findByTestId('picture-notice')).toHaveTextContent(/That photo didn’t work/);
    expect(stored()).toEqual({ kind: 'character', id: 'you-chef' });
    warn.mockRestore();
  });

  it('takes one photo at a time', async () => {
    const { services } = await renderWithAppState(<Wired />);
    const release = services.photos.hold();
    await fireEvent.press(screen.getByTestId('picture-camera'));
    await waitFor(() => expect(screen.getByTestId('picture-library')).toBeDisabled());
    await fireEvent.press(screen.getByTestId('picture-library'));
    expect(services.photos.picks).toEqual(['camera']);
    await act(async () => release());
    await waitFor(() => expect(stored().kind).toBe('photo'));
    expect(services.photos.stored()).toHaveLength(1);
  });
});
