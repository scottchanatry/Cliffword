/**
 * The library views (an experience's Story home and episode screens) over fixtures built from
 * real engine StorySession steps (libraryFixtures.ts): each screen renders its texts through
 * i18n, every control is named and 44 dp, and each calls the right StoryActions: the cliff modes
 * (recall, hint, predict), the mic's tap, hold and screen-reader toggle, feedback by the model and
 * by matching, turns, the end of an episode and of the experience, the picker, the guide; the
 * pictures (covers, the episode's scene, avatars, word pictures) and the story so far.
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { StoryActions, StoryViewModel } from '../../../session/contract';
import { defaultPacks, sharedMockModel } from '../../../services/defaults';
import { renderWithProviders } from '../../../testing/renderWithProviders';
import { layout } from '../../../theme';
import { ExperienceList } from '../../experiences/ExperienceList';
import { StoryView } from '../StoryView';
import { mockStoryActions, type MockStoryActions } from '../testing/storyTestKit';
import type { LibraryStoryOptions } from './LibraryStory';
import { LIBRARY_FIXTURE_NAMES, libraryFixtures, type LibraryFixtureName, type LibraryFixtures } from './libraryFixtures';

let fx: LibraryFixtures;
beforeAll(async () => {
  const { lang, pair } = defaultPacks();
  fx = await libraryFixtures({ lang, pair, model: sharedMockModel() });
}, 60000);

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

async function render(vm: StoryViewModel, opts: LibraryStoryOptions = {}, actions: MockStoryActions = mockStoryActions()) {
  await renderWithProviders(
    <SafeAreaProvider initialMetrics={METRICS}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StoryView vm={vm} actions={actions as unknown as StoryActions} library={{ guideSeen: true, ...opts }} />
      </GestureHandlerRootView>
    </SafeAreaProvider>,
  );
  return actions;
}

const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

/** Every button, radio and link has a name and a 44 dp target. */
function expectAccessibleControls() {
  const controls = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('radio'), ...screen.queryAllByRole('link')];
  for (const control of controls) {
    const name: unknown = control.props.accessibilityLabel ?? within(control).queryAllByText(/\S/)[0]?.props.children;
    expect({ testID: control.props.testID, named: typeof name === 'string' && name.trim().length > 0 }).toEqual({ testID: control.props.testID, named: true });
    const style = flat(control.props.style);
    const height = Math.max(Number(style.minHeight ?? 0), Number(style.height ?? 0));
    expect({ testID: control.props.testID, height: height >= layout.minTouch }).toEqual({ testID: control.props.testID, height: true });
  }
  return controls.length;
}

function cliff(name: LibraryFixtureName) {
  const s = fx[name].screen;
  if (s?.kind !== 'cliff') throw new Error(`${name} is not a cliff`);
  return s;
}

describe('every library fixture', () => {
  it.each(LIBRARY_FIXTURE_NAMES)('%s renders with named 44 dp controls', async (name) => {
    await render(fx[name]);
    expect(expectAccessibleControls()).toBeGreaterThan(0);
  });
});

describe('Story home', () => {
  it('shows the experience, "Start: Episode 1", the level and the episodes; Continue opens the episode', async () => {
    const actions = await render(fx['lib-home'], { model: { kind: 'wifi' } });
    expect(screen.getByTestId('home-title')).toHaveTextContent('Living in San Juan');
    expect(screen.getByTestId('home-continue').props.accessibilityLabel).toMatch(/^Start: Episode 1 · /);
    expect(screen.getByTestId('home-level')).toHaveTextContent('Level 0 · hear it, then pick the word');
    expect(screen.getByTestId('home-model')).toHaveTextContent(/downloads on Wi-Fi/);
    expect(screen.getAllByTestId(/^episode-row-/)).toHaveLength(8);
    expect(screen.getByTestId('episode-row-2')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('home-continue'));
    expect(actions.openEpisode).toHaveBeenCalledTimes(1);
  });

  it('after an episode: it is done and plays again from the list; "Continue: Episode 2"', async () => {
    const actions = await render(fx['lib-home-progress']);
    expect(screen.getByTestId('home-continue').props.accessibilityLabel).toMatch(/^Continue: Episode 2 · /);
    expect(within(screen.getByTestId('episode-row-1')).getByText('Done · play again')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('episode-row-1'));
    expect(actions.replayEpisode).toHaveBeenCalledWith(1);
  });

  it('"Change experience" opens the picker: coming soon cards are closed, a pick is stored', async () => {
    const onPick = jest.fn();
    await render(fx['lib-home-progress'], { onPickExperience: onPick });
    await fireEvent.press(screen.getByTestId('home-change'));
    expect(screen.getByTestId('experience-picker')).toBeOnTheScreen();
    expect(screen.getAllByText('Coming soon')).toHaveLength(5);
    expect(screen.getByTestId('experience-en-es.track.mystery')).toBeDisabled();
    expect(screen.getByTestId('experience-en-es.track.living-status')).toHaveTextContent('1 of 8 episodes done');
    expectAccessibleControls();
    // The one playing now closes the picker.
    await fireEvent.press(screen.getByTestId('experience-en-es.track.living'));
    expect(screen.queryByTestId('experience-picker')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('episode screen', () => {
  it('shows the episode title and "Line 1 of n"; close goes back to the home', async () => {
    const actions = await render(fx['lib-recall-gap']);
    const lines = cliff('lib-recall-gap').meta.library?.lines ?? 0;
    expect(screen.getByTestId('episode-title')).toHaveTextContent(/^Episode 1 · /);
    expect(screen.getByTestId('episode-progress')).toHaveTextContent(`Line 1 of ${lines}`);
    await fireEvent.press(screen.getByTestId('episode-close'));
    expect(actions.closeEpisode).toHaveBeenCalled();
  });

  it('recall while the line plays: the whole line, "Listen…", no options and no mic yet', async () => {
    await render(fx['lib-recall-playing']);
    expect(screen.getByTestId('cliff-prompt')).toHaveTextContent('Listen…');
    expect(screen.queryByTestId('cliff-options')).toBeNull();
    expect(screen.queryByTestId('mic-button')).toBeNull();
    expect(screen.queryByTestId('episode-line-gap', { includeHiddenElements: true })).toBeNull();
  });

  it('recall at the gap: three big options, Listen again, the mic and Type instead', async () => {
    const actions = await render(fx['lib-recall-gap']);
    const options = cliff('lib-recall-gap').cliff.options ?? [];
    expect(options).toHaveLength(3);
    expect(screen.getByTestId('cliff-prompt')).toHaveTextContent('Which word is missing? Tap it, or say it.');
    // The punctuation after the hidden word stays on the line: 'Son las ___. ¡Quiquiriquí!'
    expect(cliff('lib-recall-gap').sentence.text).toBe('Son las cuatro. ¡Quiquiriquí!');
    // (Words are spaced by margins, so the text content has no spaces.)
    expect(screen.getByTestId('episode-line')).toHaveTextContent('Sonlas.¡Quiquiriquí!');
    await fireEvent.press(screen.getByTestId('option-2'));
    expect(actions.pickOption).toHaveBeenCalledWith(2);
    await fireEvent.press(screen.getByTestId('listen-again'));
    expect(actions.replay).toHaveBeenCalled();
    // Tap the line: the English shows.
    expect(screen.queryByTestId('episode-english')).toBeNull();
    await fireEvent.press(screen.getByTestId('line-toggle'));
    expect(screen.getByTestId('episode-english')).toHaveTextContent(cliff('lib-recall-gap').translation ?? '');
    // Type instead.
    await fireEvent.press(screen.getByTestId('mic-button-type'));
    await fireEvent.changeText(screen.getByLabelText('Type your answer'), 'cuatro');
    await fireEvent(screen.getByLabelText('Type your answer'), 'submitEditing');
    expect(actions.typeAnswer).toHaveBeenCalledWith('cuatro');
  });

  it('the mic: a tap toggles, press and hold talks, the screen reader double tap toggles', async () => {
    const actions = await render(fx['lib-recall-gap']);
    const mic = screen.getByTestId('mic-button');
    expect(mic.props.accessibilityLabel).toBe('Answer out loud');
    await fireEvent.press(mic);
    expect(actions.micTap).toHaveBeenCalledTimes(1);
    await fireEvent(mic, 'longPress');
    expect(actions.holdBegin).toHaveBeenCalledTimes(1);
    expect(actions.holdStart).toHaveBeenCalledTimes(1);
    await fireEvent(mic, 'pressOut');
    expect(actions.holdEnd).toHaveBeenCalledTimes(1);
    await fireEvent(mic, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(actions.micTap).toHaveBeenCalledTimes(2);
  });

  it('listening in tap mode: the partial transcript, "tap to send", a stop name for screen readers', async () => {
    await render(fx['lib-recall-listening']);
    expect(screen.getByTestId('mic-button-label')).toHaveTextContent('Listening… tap to send');
    expect(screen.getByTestId('mic-button').props.accessibilityLabel).toBe('Stop and send');
    expect(screen.getByTestId('mic-button-partial')).toBeOnTheScreen();
  });

  it('hint: the English line with the word in bold; the mic first, "Show options" second', async () => {
    const actions = await render(fx['lib-hint']);
    const hint = cliff('lib-hint').translationHint;
    expect(screen.getByTestId('hint-translation')).toBeOnTheScreen();
    expect(screen.getByTestId('hint-word')).toHaveTextContent(hint?.found ? (cliff('lib-hint').translation ?? '').slice(hint.start, hint.end) : (hint?.text ?? ''));
    expect(screen.queryByTestId('cliff-options')).toBeNull();
    expect(screen.getByTestId('mic-button')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('show-options'));
    expect(actions.command).toHaveBeenCalledWith('dont_know');
  });

  it('hint after a miss: what was said and the three options', async () => {
    await render(fx['lib-hint-missed']);
    expect(screen.getByTestId('cliff-prompt')).toHaveTextContent('Not quite (“mesa”). Pick the one that fits.');
    expect(screen.getByTestId('cliff-options')).toBeOnTheScreen();
    expect(screen.queryByTestId('show-options')).toBeNull();
  });

  it('predict: no English yet, the mic first, "No sé" second', async () => {
    const actions = await render(fx['lib-predict']);
    expect(screen.queryByTestId('hint-translation')).toBeNull();
    expect(screen.queryByTestId('line-toggle')).toBeNull();
    expect(screen.getByTestId('cliff-prompt')).toHaveTextContent('Say what comes next.');
    await fireEvent.press(screen.getByTestId('no-se'));
    expect(actions.command).toHaveBeenCalledWith('dont_know');
  });
});

describe('feedback', () => {
  it('a right pick: the check, "You picked", the story word, the English; Next', async () => {
    const actions = await render({ ...fx['lib-feedback'], modelMode: 'canned' });
    const s = fx['lib-feedback'].screen;
    if (s?.kind !== 'landing') throw new Error('not a landing');
    expect(screen.getByTestId('feedback-full')).toBeOnTheScreen();
    expect(screen.getByTestId('feedback-answer')).toHaveTextContent(`You picked: ${s.expected}`);
    expect(screen.getByTestId('feedback-story')).toHaveTextContent(`The story says: ${s.expected}`);
    expect(screen.getByTestId('feedback-translation')).toHaveTextContent(s.translation ?? '');
    // A picked option was checked by the option itself: no checker line.
    expect(screen.queryByTestId('feedback-checked')).toBeNull();
    await fireEvent.press(screen.getByTestId('episode-next'));
    expect(actions.next).toHaveBeenCalled();
  });

  it('a wrong pick: a soft "Not quite" with the story word', async () => {
    await render(fx['lib-feedback-wrong']);
    expect(screen.getByTestId('feedback-none')).toBeOnTheScreen();
    expect(screen.getByText('Not quite')).toBeOnTheScreen();
  });

  it('said and checked by the model: "Checked by the language model on your phone", other natural answers', async () => {
    await render(fx['lib-feedback-model']);
    expect(screen.getByTestId('feedback-checked')).toHaveTextContent('Checked by the language model on your phone');
    const s = fx['lib-feedback-model'].screen;
    if (s?.kind === 'landing' && (s.alternatives ?? []).length > 0) expect(screen.getByTestId('feedback-also')).toHaveTextContent(/^Also natural: /);
  });

  it('said and checked by matching while the model downloads', async () => {
    const s = fx['lib-feedback-model'].screen;
    if (s?.kind !== 'landing') throw new Error('not a landing');
    await render({ ...fx['lib-feedback-model'], modelMode: 'canned', screen: { ...s, scoredBy: 'canned', outcome: { ...s.outcome, scoredBy: 'canned' } } });
    expect(screen.getByTestId('feedback-checked')).toHaveTextContent('Checked by matching. The language model is still downloading.');
  });

  it('"no sé": the word, the line, the English; the mic to say it and Next', async () => {
    const actions = await render(fx['lib-nose']);
    const s = fx['lib-nose'].screen;
    if (s?.kind !== 'noSe') throw new Error('not noSe');
    expect(screen.getByText(`The word was: ${s.answer}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('episode-next'));
    expect(actions.next).toHaveBeenCalled();
  });
});

describe('turns, the end of an episode and of the experience', () => {
  it('a question: the speaker asks, the English on tap, the mic, "Show me an example"', async () => {
    const actions = await render(fx['lib-turn']);
    const s = fx['lib-turn'].screen;
    if (s?.kind !== 'turn') throw new Error('not a turn');
    expect(screen.getByText(`${s.prompt.speaker} asks you`)).toBeOnTheScreen();
    expect(screen.getByTestId('turn-question')).toHaveTextContent(s.prompt.line);
    await fireEvent.press(screen.getByTestId('question-toggle'));
    expect(screen.getByTestId('episode-english')).toHaveTextContent(s.translation ?? '');
    expect(screen.getByTestId('mic-button')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('turn-example-button'));
    expect(actions.command).toHaveBeenCalledWith('dont_know');
  });

  it('a reply: what was said, whether it counts, the example answer and Next', async () => {
    const actions = await render(fx['lib-turn-reply']);
    expect(screen.getByTestId('turn-reply')).toHaveTextContent(/You said: /);
    expect(screen.getByTestId('turn-example')).toHaveTextContent(/^You could say: /);
    expect(screen.queryByTestId('mic-button')).toBeNull();
    await fireEvent.press(screen.getByTestId('episode-next'));
    expect(actions.next).toHaveBeenCalled();
  });

  it('an episode done: the score, the level line, "Next episode" and back to the episodes', async () => {
    const actions = await render(fx['lib-episode-done']);
    const s = fx['lib-episode-done'].screen;
    if (s?.kind !== 'episodeDone') throw new Error('not episodeDone');
    expect(screen.getByText('Episode 1 done!')).toBeOnTheScreen();
    // The fixture picks one option right and one wrong, then says the rest: right answers count
    // taps too; 'on your own' is what moves the level.
    expect(s.correct).toBeGreaterThan(s.unaided);
    expect(screen.getByTestId('episode-done-score')).toHaveTextContent(`You got ${s.correct} of ${s.cliffs} right.`);
    expect(screen.getByTestId('episode-done-unaided')).toHaveTextContent(`${s.unaided} of them on your own, without the options.`);
    expect(screen.getByTestId('episode-done-level')).toHaveTextContent(/level/i);
    await fireEvent.press(screen.getByTestId('episode-done-next'));
    expect(actions.next).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('episode-done-home'));
    expect(actions.closeEpisode).toHaveBeenCalled();
  });

  it('an episode tapped all right: says how to move up instead of "tricky"', async () => {
    const s = fx['lib-episode-done'].screen;
    if (s?.kind !== 'episodeDone') throw new Error('not episodeDone');
    await render({ ...fx['lib-episode-done'], screen: { ...s, correct: s.cliffs, unaided: 0, levelChange: 0 } });
    expect(screen.getByTestId('episode-done-score')).toHaveTextContent(`You got ${s.cliffs} of ${s.cliffs} right.`);
    expect(screen.getByText('Nice! To move up a level, say or type the words instead of tapping them.')).toBeOnTheScreen();
    expect(screen.queryByText(/tricky/)).toBeNull();
  });

  it('the experience done: celebrate, and the other experiences are coming soon', async () => {
    const actions = await render(fx['lib-track-done'], { onPickExperience: jest.fn() });
    expect(screen.getByText('You finished Living in San Juan!')).toBeOnTheScreen();
    expect(screen.getByText(/More experiences are coming soon/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('track-done-home'));
    expect(actions.closeEpisode).toHaveBeenCalled();
  });
});

describe('pictures and the story so far', () => {
  const imageOf = (testID: string) => screen.getByTestId(testID, { includeHiddenElements: true });

  it('the home and the picker show covers; coming-soon covers are faded; the Start card shows the episode scene', async () => {
    await render(fx['lib-home'], { onPickExperience: jest.fn() });
    expect(imageOf('cover-living').props.accessible).toBe(false);
    expect(imageOf('home-continue-scene').props.accessible).toBe(false);
    expect(screen.queryByTestId('motif-pr', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(screen.getByTestId('home-change'));
    expect(flat(imageOf('cover-mystery').props.style).opacity).toBe(0.45);
    expect(flat(screen.getAllByTestId('cover-living', { includeHiddenElements: true }).at(-1)?.props.style).opacity).toBeUndefined();
  });

  it('a series without a cover keeps the colored motif', async () => {
    const card = { id: 'en-es.track.unwritten', title: 'Unwritten', tagline: 'Soon.', city: 'Ponce', country: 'Puerto Rico', dialect: 'pr' as const, comingSoon: true, episodes: 0, completed: 0, current: false, done: false, missingChoices: [] };
    await renderWithProviders(<ExperienceList cards={[card]} onPick={jest.fn()} />);
    expect(screen.getByTestId('motif-pr', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('cover-unwritten', { includeHiddenElements: true })).toBeNull();
  });

  it('a line: the scene on top, the speaker avatar beside the name; no story so far on line 1', async () => {
    await render(fx['lib-recall-gap']);
    expect(imageOf('episode-scene').props.accessible).toBe(false);
    expect(screen.queryByTestId('transcript')).toBeNull();
    // Line 1 is narration: no speaker, no avatar. The first line says the English is a tap away.
    expect(screen.queryByTestId('episode-speaker')).toBeNull();
    expect(screen.getByTestId('line-tap-hint')).toHaveTextContent('Tap the line for the English');
  });

  it('deep in an episode: the earlier lines as a conversation, narration centered, the replies on the right', async () => {
    const vm = fx['lib-story-so-far'];
    const s = cliff('lib-story-so-far');
    const entries = vm.transcript?.entries ?? [];
    expect(entries.filter((e) => e.kind === 'line')).toHaveLength(11);
    expect(entries.filter((e) => e.kind === 'reply').map((e) => e.text)).toEqual(['Estoy cansada.', 'Me llamo Alex. Mucho gusto.', 'No entiendo. ¿Puedes repetir?']);
    await render(vm);
    expect(screen.getByTestId('transcript')).toBeOnTheScreen();
    // Narration (line 1) is plain text; Doña Mari's line 3 has her name; the gap's word is in the line.
    expect(screen.getByTestId('transcript-e1.l01').props.accessibilityLabel).toBe('Son las cuatro. ¡Quiquiriquí!');
    expect(screen.getByTestId('transcript-e1.l03').props.accessibilityLabel).toBe('Doña Mari: ¡Hola! ¡Buenos días, vecina!');
    expect(screen.getByTestId('transcript-e1.l04-text')).toHaveTextContent('Ya lo sé. Estás cansada.');
    expect(screen.getByTestId('transcript-e1.t01').props.accessibilityLabel).toBe('Doña Mari: ¿Cómo estás?');
    const replies = screen.getAllByTestId('transcript-reply');
    expect(replies).toHaveLength(3);
    expect(replies[0]?.props.accessibilityLabel).toBe('You said: Estoy cansada.');
    expect(screen.getAllByTestId('transcript-you-avatar', { includeHiddenElements: true })).toHaveLength(3);
    // A tap shows the English and the pictures of the line's words; another tap hides them.
    expect(screen.queryByTestId('transcript-e1.l02-english')).toBeNull();
    await fireEvent.press(screen.getByTestId('transcript-e1.l02'));
    expect(screen.getByTestId('transcript-e1.l02-english')).toHaveTextContent("It's Pancho, the neighbor's rooster.");
    expect(screen.getByTestId('transcript-e1.l02-pictures-gallo').props.accessibilityLabel).toBe('gallo');
    await fireEvent.press(screen.getByTestId('transcript-e1.l02'));
    expect(screen.queryByTestId('transcript-e1.l02-english')).toBeNull();
    // The line on screen stays the focus, with the scene above the conversation; later lines leave
    // the tap hint out (the room goes to the conversation).
    expect(screen.getByTestId('episode-line')).toBeOnTheScreen();
    expect(screen.queryByTestId('line-tap-hint')).toBeNull();
    expect(s.meta.library?.line).toBe(12);
    expectAccessibleControls();
  });

  it("the line on screen: the English shows pictures of the words on show, never of the hidden word", async () => {
    const s = cliff('lib-story-so-far');
    // '¡Y Pancho tiene tu pan!': the gap is 'pan', which has a picture.
    expect(s.sentence.text).toBe('¡Y Pancho tiene tu pan!');
    await render(fx['lib-story-so-far']);
    await fireEvent.press(screen.getByTestId('line-toggle'));
    expect(screen.getByTestId('episode-english')).toHaveTextContent('And Pancho has your bread!');
    expect(screen.queryByTestId('line-pictures-pan-sobao')).toBeNull();
    // Once the whole line is on show (recall, while it plays), its word's picture shows too.
    const whole = { ...s, phase: 'playing' as const, sentence: { ...s.sentence, words: s.sentence.words.map((w) => ({ ...w, display: 'text' as const })) } };
    await render({ ...fx['lib-story-so-far'], screen: whole });
    await fireEvent.press(screen.getByTestId('line-toggle'));
    expect(screen.getByTestId('line-pictures-pan-sobao').props.accessibilityLabel).toBe('pan');
  });

  it("feedback: the story word's picture beside the answer, and the speaker's avatar", async () => {
    const s = fx['lib-feedback-wrong'].screen;
    if (s?.kind !== 'landing') throw new Error('not a landing');
    expect(s.expected).toBe('gallo');
    await render(fx['lib-feedback-wrong']);
    expect(screen.getByTestId('feedback-picture').props.accessibilityLabel).toBe('gallo');
    // Line 1 of the conversation above.
    expect(screen.getByTestId('transcript-e1.l01')).toBeOnTheScreen();
    await render(fx['lib-feedback']);
    expect(screen.queryByTestId('feedback-picture')).toBeNull();
  });

  it("a question: the asker's avatar beside 'Doña Mari asks you'", async () => {
    await render(fx['lib-turn']);
    expect(screen.getByTestId('turn-speaker')).toHaveTextContent('Doña Mari asks you');
    expect(imageOf('turn-speaker-avatar').props.accessible).toBe(false);
    expect(screen.getByTestId('transcript')).toBeOnTheScreen();
  });
});

describe('first-episode guide', () => {
  it('shows listen, then answer at the gap, then feedback, once; skipping stores it', async () => {
    const onGuideDone = jest.fn();
    let show: (vm: StoryViewModel) => void = () => undefined;
    function Harness() {
      const [vm, setVm] = useState(fx['lib-recall-playing']);
      show = setVm;
      return <StoryView vm={vm} actions={mockStoryActions() as unknown as StoryActions} library={{ guideSeen: false, onGuideDone }} />;
    }
    await renderWithProviders(
      <SafeAreaProvider initialMetrics={METRICS}>
        <Harness />
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId('guide-listen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('guide-next'));
    // The answer tip waits for the gap.
    expect(screen.queryByTestId('guide-answer')).toBeNull();
    await act(async () => show(fx['lib-recall-gap']));
    expect(screen.getByTestId('guide-answer')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('guide-next'));
    expect(screen.queryByTestId('guide-feedback')).toBeNull();
    await act(async () => show(fx['lib-feedback']));
    expect(screen.getByTestId('guide-feedback')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('guide-next'));
    expect(onGuideDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(/^guide-/)).toBeNull();
  });

  it('"Skip the tips" ends the guide and stores it', async () => {
    const onGuideDone = jest.fn();
    await render(fx['lib-recall-gap'], { guideSeen: false, onGuideDone });
    expect(screen.getByTestId('guide-listen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('guide-skip'));
    expect(onGuideDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(/^guide-/)).toBeNull();
  });

  it('is not shown once seen', async () => {
    await render(fx['lib-recall-gap'], { guideSeen: true });
    expect(screen.queryByTestId('guide-listen')).toBeNull();
  });
});
