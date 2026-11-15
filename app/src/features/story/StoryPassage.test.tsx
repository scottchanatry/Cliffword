import { screen } from '@testing-library/react-native';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { passageWords, SAMPLE_PASSAGE } from './sample';
import { StoryPassage } from './StoryPassage';

describe('StoryPassage', () => {
  it('shows the text, the cliff gap and the gloss line', async () => {
    await renderWithProviders(<StoryPassage passage={SAMPLE_PASSAGE} showText gloss="stall" />);
    expect(screen.getByTestId('story-text')).toBeOnTheScreen();
    expect(screen.getByText('puesto · stall · new for you')).toBeOnTheScreen();
    expect(screen.getByLabelText('Gap: the story stops here')).toBeOnTheScreen();
  });

  it('shows one tile per word when text is hidden, words split by the language pack', async () => {
    const { services } = await renderWithProviders(<StoryPassage passage={SAMPLE_PASSAGE} showText={false} />);
    const words = passageWords(SAMPLE_PASSAGE, services.packs.lang);
    // Punctuation is not a word: "mercado." is one word tile, "frutas," too.
    expect(words).toContain('mercado');
    expect(words).not.toContain('mercado.');
    expect(words).toHaveLength(26);
    expect(screen.getAllByLabelText('Hidden word. Tap to hear it, hold to see it.')).toHaveLength(words.length);
    expect(screen.queryByTestId('story-text')).toBeNull();
  });

  it('never splits on spaces: tiles follow the pack segmenter', async () => {
    const lang = { segment: (text: string) => [{ text, norm: text, start: 0, end: text.length, kind: 'word' as const }] };
    expect(passageWords(SAMPLE_PASSAGE, lang)).toHaveLength(1);
  });
});
