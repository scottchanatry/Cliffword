/**
 * StoryView over fixtures built from real engine StorySession steps (fixtures.ts): every
 * screen kind renders its key texts through i18n and calls the right StoryActions; tiles,
 * hold anywhere, heat, retell lanes and accessibility are checked on the same fixtures.
 */
import { StyleSheet } from 'react-native';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { createGestureController, fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { createDefaultPairPack } from '@cliffword/engine';
import { REPORTABLE_KINDS } from '../../session/story/report';
import { colors, heatColors, layout } from '../../theme';
import { STORY_FIXTURE_NAMES, viewModel, type StoryFixtureName, type StoryFixtures } from './fixtures';
import { laneLengths } from './RetellView';
import { nextTextMode } from './StoryHeader';
import { showsReportableSentence } from './StoryView';
import { loadFixtures, mockStoryActions, renderStory } from './testing/storyTestKit';

let fx: StoryFixtures;
beforeAll(async () => {
  fx = await loadFixtures();
}, 60000);

const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;
const activate = (el: ReturnType<typeof screen.getByTestId>, actionName = 'activate') =>
  fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName } });

/** Every button and toggle has a name and a 44 dp target (the route tests' rule). */
function expectAccessibleControls() {
  const controls = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('togglebutton'), ...screen.queryAllByRole('link')];
  for (const control of controls) {
    const name: unknown = control.props.accessibilityLabel ?? within(control).queryAllByText(/\S/)[0]?.props.children;
    expect({ testID: control.props.testID, named: typeof name === 'string' && name.trim().length > 0 }).toEqual({ testID: control.props.testID, named: true });
    const style = flat(control.props.style);
    const height = Math.max(Number(style.minHeight ?? 0), Number(style.height ?? 0));
    expect({ testID: control.props.testID, height: height >= layout.minTouch }).toEqual({ testID: control.props.testID, height: true });
  }
  return controls.length;
}

describe('every fixture', () => {
  it.each(STORY_FIXTURE_NAMES)('%s renders with named 44 dp controls', async (name: StoryFixtureName) => {
    await renderStory(fx[name]);
    expect(screen.getByTestId('story-view')).toBeOnTheScreen();
    expectAccessibleControls();
  });
});

describe('cliff, mostly text (Main)', () => {
  it('shows the passage, the gloss chip, the meta line and the free rung card', async () => {
    await renderStory(fx.main);
    expect(screen.getByTestId('story-meta')).toHaveTextContent('Chapter 1 · El mercado · spoken 4:12');
    expect(screen.getByText('puesto · stall · new for you')).toBeOnTheScreen();
    expect(screen.getByText('Say what comes next')).toBeOnTheScreen();
    expect(screen.getByTestId('cliff-rung-line')).toHaveTextContent('Any natural answer counts. One to three words, out loud.');
    expect(screen.getByRole('button', { name: 'Hold to speak' })).toBeOnTheScreen();
    // The ink gap, announced as a gap; words after the cliff are not shown yet.
    expect(screen.getByLabelText('Gap: the story stops here')).toBeOnTheScreen();
    expect(screen.queryByText(/voz/)).toBeNull();
    // Earlier sentences of the chapter come first, as written.
    expect(screen.getByText(/mercado\./)).toBeOnTheScreen();
  });

  it('sends Type instead, Hear it again, Skip and the text pill to the actions', async () => {
    const { actions } = await renderStory(fx.main);
    await fireEvent.press(screen.getByRole('button', { name: 'Hear it again' }));
    expect(actions.replay).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
    expect(actions.command).toHaveBeenCalledWith('dont_know');
    await fireEvent.press(screen.getByTestId('text-mode'));
    expect(actions.setTextMode).toHaveBeenCalledWith('all_tiles');
    await fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
    await fireEvent.changeText(screen.getByTestId('type-input'), '  leerla ');
    await fireEvent.press(screen.getByTestId('type-send'));
    expect(actions.typeAnswer).toHaveBeenCalledWith('leerla');
  });

  it('taps a text word to hear it', async () => {
    const { actions } = await renderStory(fx.main);
    fireGestureHandler(getByGestureTestId('word-3-tap'), [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: State.END }]);
    expect(actions.hearWord).toHaveBeenCalledWith(3);
  });
});

describe('cliff, mostly tiles (B1)', () => {
  it('shows tiles named "Word n", the live gap, future outlines, the legend and the hold area', async () => {
    await renderStory(fx.b1);
    const current = fx.b1.screen?.kind === 'cliff' ? fx.b1.screen.sentence.words : [];
    const tiles = current.filter((w) => w.display === 'tile');
    expect(tiles.length).toBeGreaterThan(5);
    for (const w of tiles) {
      const tile = screen.getByTestId(`tile-${w.index}`);
      expect(tile.props.accessibilityLabel).toBe(`Word ${w.index + 1}`);
      expect(tile.props.accessibilityLabel).not.toContain(w.text);
      expect(screen.queryByText(w.text, { exact: true })).toBeNull();
    }
    expect(screen.getByLabelText('Gap: the story stops here')).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^future-/, { includeHiddenElements: true })).toHaveLength(3);
    expect(screen.getByTestId('tile-legend')).toHaveTextContent('Every tile is a word you heard. Tap one to hear it again. Hold one to see it, like puesto · stall.');
    expect(screen.getByText('Hold anywhere and say it')).toBeOnTheScreen();
    expect(screen.getByText('What comes next? Any natural answer counts.')).toBeOnTheScreen();
    // "puesto" was held to see in the sentence before: an ink chip.
    expect(screen.getByText('puesto')).toBeOnTheScreen();
    // Tile widths follow the spoken length.
    const face = flat(screen.getByTestId(`tile-${tiles[0]?.index}-face`).props.style);
    expect(face.width).toBe(Math.round((tiles[0]?.durationMs ?? 0) * 0.115));
    expect(face.backgroundColor).toBe(colors.tileOld);
  });

  it('taps a tile to hear it and holds it to see it; the hold blocks hold-anywhere', async () => {
    const { actions } = await renderStory(fx.b1);
    fireGestureHandler(getByGestureTestId('tile-3-tap'), [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: State.END }]);
    expect(actions.hearWord).toHaveBeenCalledWith(3);
    fireGestureHandler(getByGestureTestId('tile-3-hold'), [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: State.END }]);
    expect(actions.revealWord).toHaveBeenCalledWith(3);
    expect(actions.holdStart).not.toHaveBeenCalled();
    const root = getByGestureTestId('hold-anywhere') as unknown as { handlerTag: number };
    const hold = getByGestureTestId('tile-3-hold') as unknown as { gestureRelations?: { blocksHandlers: number[] } };
    expect(hold.gestureRelations?.blocksHandlers).toContain(root.handlerTag);
    // Screen readers: activate hears it, the long-press action shows it.
    await activate(screen.getByTestId('tile-4'));
    expect(actions.hearWord).toHaveBeenCalledWith(4);
    await activate(screen.getByTestId('tile-4'), 'longpress');
    expect(actions.revealWord).toHaveBeenCalledWith(4);
  });

  it('sends the command chips and the pill', async () => {
    const { actions } = await renderStory(fx.b1);
    await fireEvent.press(screen.getByRole('button', { name: 'Otra vez, again' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Más despacio, slower' }));
    await fireEvent.press(screen.getByRole('button', { name: 'No sé, skip' }));
    expect(actions.command.mock.calls).toEqual([['again'], ['slower'], ['dont_know']]);
    expect(screen.getByTestId('text-mode')).toHaveTextContent('Show text');
    await fireEvent.press(screen.getByTestId('text-mode'));
    expect(actions.setTextMode).toHaveBeenCalledWith('all_text');
  });

  it('lights the word being spoken', async () => {
    await renderStory(fx.speaking);
    expect(flat(screen.getByTestId('tile-3-face').props.style).backgroundColor).toBe(colors.live);
    expect(flat(screen.getByTestId('tile-4-face').props.style).backgroundColor).toBe(colors.tileOld);
  });
});

describe('hold anywhere', () => {
  it('warms on touch-down, listens after the hold, sends on release', async () => {
    const { actions } = await renderStory(fx.b1);
    fireGestureHandler(getByGestureTestId('hold-anywhere'), [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: State.END }]);
    expect(actions.holdBegin).toHaveBeenCalledTimes(1);
    expect(actions.holdStart).toHaveBeenCalledTimes(1);
    expect(actions.holdEnd).toHaveBeenCalledTimes(1);
    expect(actions.holdCancel).not.toHaveBeenCalled();
  });

  it('drops the utterance when the touch is cancelled, and cools down after a tap', async () => {
    const { actions } = await renderStory(fx.b1);
    fireGestureHandler(getByGestureTestId('hold-anywhere'), [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: State.CANCELLED }]);
    expect(actions.holdCancel).toHaveBeenCalledTimes(1);
    expect(actions.holdEnd).not.toHaveBeenCalled();
    // A quick tap: the long press begins, then fails before it activates.
    const tap = createGestureController('hold-anywhere');
    tap.begin();
    tap.fail();
    expect(actions.holdBegin).toHaveBeenCalledTimes(2);
    expect(actions.holdStart).toHaveBeenCalledTimes(1);
    expect(actions.holdCancel).toHaveBeenCalledTimes(2);
  });

  it('is a toggle button for screen readers, and shows the live transcript while listening', async () => {
    const { actions } = await renderStory(fx.b1);
    const area = screen.getByTestId('hold-area');
    expect(area.props.accessibilityRole).toBe('button');
    expect(area.props.accessibilityActions).toEqual([{ name: 'activate', label: 'Start listening' }]);
    await activate(area);
    expect(actions.holdBegin).toHaveBeenCalledTimes(1);
    expect(actions.holdStart).toHaveBeenCalledTimes(1);

    const listening = await renderStory(fx.listening);
    expect(screen.getByText('leerla en')).toBeOnTheScreen();
    expect(screen.getByText('Let go when you finish.')).toBeOnTheScreen();
    await activate(screen.getByRole('button', { name: 'Stop listening' }));
    expect(listening.actions.holdEnd).toHaveBeenCalledTimes(1);
  });

  it('reminds a quick tap on the hold area to hold', async () => {
    await renderStory(fx.b1);
    await fireEvent.press(screen.getByTestId('hold-area'));
    expect(screen.getByText('Press and hold while you say your answer, then let go.')).toBeOnTheScreen();
  });
});

describe('cliff rungs', () => {
  it('options: two or three buttons, tap one to pick it, the one being read is lit', async () => {
    const { actions } = await renderStory({ ...fx.options, speakingOption: 1 });
    const cliff = fx.options.screen?.kind === 'cliff' ? fx.options.screen.cliff : null;
    expect(cliff?.rung).toBe('options');
    expect(screen.getByTestId('cliff-rung-line')).toHaveTextContent('Pick the one that fits.');
    const options = within(screen.getByTestId('cliff-options')).getAllByRole('button');
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options.length).toBeLessThanOrEqual(3);
    const natural = cliff?.options?.find((o) => o.text === 'mercado');
    await fireEvent.press(screen.getByRole('button', { name: 'mercado' }));
    expect(actions.pickOption).toHaveBeenCalledWith(natural?.index);
    expect(flat(screen.getByTestId('option-1').props.style).borderColor).toBe(colors.live);
    expect(screen.getByText('You can answer in English. You’ll hear the Spanish to repeat.')).toBeOnTheScreen();
  });

  it('options in the Voice look sit above the hold area', async () => {
    const { actions } = await renderStory({ ...fx.options, textMode: 'all_tiles' });
    expect(screen.getByTestId('hold-area')).toBeOnTheScreen();
    await fireEvent.press(within(screen.getByTestId('cliff-options')).getAllByRole('button')[0] as never);
    expect(actions.pickOption).toHaveBeenCalledTimes(1);
  });

  it('hint: the first sound, shown and in the rung line', async () => {
    await renderStory(fx.hint);
    expect(screen.getByTestId('cliff-rung-line')).toHaveTextContent('It starts with “le”.');
    expect(screen.getByTestId('cliff-hint')).toHaveTextContent('le');
  });

  it('a multi-word free cliff asks for about that many words', async () => {
    const main = fx.main.screen;
    if (main?.kind !== 'cliff') throw new Error('main is a cliff');
    await renderStory({ ...fx.main, screen: { ...main, cliff: { ...main.cliff, length: 3 } } });
    expect(screen.getByTestId('cliff-rung-line')).toHaveTextContent('Any natural answer counts. About 3 words, out loud.');
  });
});

describe('landing (B2)', () => {
  it('shows the headline, the landing line, the notes and the answer lit', async () => {
    await renderStory(fx.b2);
    expect(screen.getByTestId('landing-headline')).toHaveTextContent('You landed where a Spanish speaker would.');
    expect(screen.getByTestId('landing-you-said')).toHaveTextContent('You said “leer”.');
    expect(screen.getByTestId('landing-line')).toBeOnTheScreen();
    expect(screen.getByLabelText('Your answer “leer” landed near the expected end, on a line from surprising to expected.')).toBeOnTheScreen();
    expect(screen.getByTestId('landing-notes')).toHaveTextContent('About 6 times in 100, a Spanish speaker says that here. “leerla” is just as natural.');
    expect(screen.getByText('surprising')).toBeOnTheScreen();
    expect(screen.getByText('expected')).toBeOnTheScreen();
    // The story's own word is lit live orange among the tiles.
    const landing = fx.b2.screen?.kind === 'landing' ? fx.b2.screen : null;
    const leerla = landing?.sentence.words.find((w) => w.text === 'leerla');
    const chip = within(screen.getByTestId(`word-${leerla?.index}`)).getByText('leerla');
    expect(flat(chip.parent?.props.style).backgroundColor).toBe(colors.live);
    expect(screen.getByText('Hold anywhere, say the whole line')).toBeOnTheScreen();
  });

  it('sends Otra vez, ¿Qué significa? and Siguiente', async () => {
    const { actions } = await renderStory(fx.b2);
    await fireEvent.press(screen.getByRole('button', { name: 'Otra vez, again' }));
    await fireEvent.press(screen.getByRole('button', { name: '¿Qué significa?, meaning' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Siguiente, next' }));
    expect(actions.command.mock.calls).toEqual([['again'], ['meaning'], ['next']]);
  });

  it('after the whole line is said: "Words understood: N of M", never an accent score', async () => {
    await renderStory(fx.landing);
    const shadow = fx.landing.screen?.kind === 'landing' ? fx.landing.screen.shadow : undefined;
    expect(shadow).toBeDefined();
    expect(screen.getByText(`Words understood: ${shadow?.understood} of ${shadow?.total}`)).toBeOnTheScreen();
    expect(screen.getAllByTestId(/understood-\d+-missed/)).toHaveLength((shadow?.total ?? 0) - (shadow?.understood ?? 0));
    expect(screen.queryByText(/accent/i)).toBeNull();
  });
});

describe('no sé', () => {
  it('shows the steps, the answer to repeat and the repeat alignment', async () => {
    const { actions } = await renderStory(fx.noSe);
    expect(screen.getByTestId('nose-step-hear')).toHaveTextContent('Hear it');
    expect(screen.getByTestId('nose-answer')).toHaveTextContent('mercado');
    expect(screen.getByTestId('nose-ui')).toHaveTextContent('Now say it out loud.');
    expect(screen.getByText('Words understood: 0 of 1')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Play the answer again' }));
    expect(actions.replay).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('story-canned')).toBeOnTheScreen();
  });
});

describe('native reply', () => {
  it('shows what was heard, the target words with a play button, and the phrases', async () => {
    const { actions } = await renderStory(fx.nativeReply);
    expect(screen.getByTestId('native-heard')).toHaveTextContent('You said “closed”.');
    expect(screen.getByTestId('native-target')).toHaveTextContent('cerrado');
    expect(within(screen.getByTestId('native-phrases')).getByText('closed')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Play the words to say' }));
    expect(actions.replay).toHaveBeenCalledTimes(1);
  });
});

describe('learner turn and self-repair (A2)', () => {
  it('turn: "Marta asks you", the question with its play button', async () => {
    const { actions } = await renderStory(fx.turn);
    expect(screen.getByTestId('story-meta')).toHaveTextContent('Marta asks you');
    expect(screen.getByText('¿Y tú? ¿Qué hiciste ayer?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Play Marta’s question' }));
    expect(actions.replay).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Hold anywhere and answer')).toBeOnTheScreen();
  });

  it('prompt_repair: heat on the words, the flagged word strongest, Say it again / Show me the answer', async () => {
    const { actions } = await renderStory(fx.a2);
    const repair = fx.a2.screen?.kind === 'repair' ? fx.a2.screen : null;
    expect(repair?.phase).toBe('prompt_repair');
    expect(screen.getByText('One word surprised me')).toBeOnTheScreen();
    expect(screen.getByTestId('repair-body')).toHaveTextContent('Say it again and try a different word. You get the answer after this try.');
    expect(screen.getByText('You said')).toBeOnTheScreen();
    expect(screen.getByTestId('heat-legend')).toBeOnTheScreen();
    repair?.said.forEach((w, i) => {
      const heat = i === repair.highlight ? Math.max(2, w.heat) : w.heat;
      expect(flat(screen.getByTestId(`said-${i}-word`).props.style).backgroundColor).toBe(heatColors[heat] ?? undefined);
    });
    expect(screen.getByLabelText('Soy, the word that surprised me')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Show me the answer' }));
    expect(actions.command).toHaveBeenCalledWith('dont_know');
    await activate(screen.getByTestId('repair-say-again'));
    expect(actions.holdStart).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('up-next')).toHaveTextContent('Up nextRetell this scene aloud in 60 seconds, then 45, then 30.');
  });

  it('hinted: only what was expected, no fix wording and no explanation', async () => {
    await renderStory(fx.repairHinted);
    expect(screen.getByTestId('repair-expected')).toHaveTextContent('Expected: Estoy muy cansado.');
    expect(screen.queryByTestId('repair-fix')).toBeNull();
    expect(screen.queryByTestId('repair-explanation')).toBeNull();
    expect(screen.queryByText(/^Try:/)).toBeNull();
    expect(flat(screen.getByTestId('said-8-word').props.style).backgroundColor).toBe(colors.heat2);
  });

  it('show_answer: the fix and the exact explanation of the rule', async () => {
    const { actions } = await renderStory(fx.repairAnswer);
    const repair = fx.repairAnswer.screen?.kind === 'repair' ? fx.repairAnswer.screen : null;
    expect(screen.getByTestId('repair-fix')).toHaveTextContent('Try: Estoy muy cansado.');
    const explanation = createDefaultPairPack().explanations[repair?.explainKey ?? ''];
    expect(explanation).toBeTruthy();
    expect(screen.getByTestId('repair-explanation')).toHaveTextContent(explanation as string);
    expect(screen.getByTestId('repair-attempts')).toHaveTextContent('2 tries');
    await fireEvent.press(screen.getByTestId('repair-next'));
    expect(actions.next).toHaveBeenCalledTimes(1);
  });
});

describe('up next', () => {
  it('offers the retell', async () => {
    const { actions } = await renderStory(fx.upNext);
    expect(screen.getByText('Chapter done')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Start the retell' }));
    expect(actions.next).toHaveBeenCalledTimes(1);
  });

  it('offers register switching at the top of the frequency list', async () => {
    const up = fx.upNext.screen;
    if (up?.kind !== 'upNext') throw new Error('upNext');
    const { actions } = await renderStory(viewModel({ ...up, advanced: ['register_switch', 'brought_text', 'lyrics'] }));
    await fireEvent.press(screen.getByRole('button', { name: 'Switch register' }));
    expect(actions.startRegisterTask).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Practise with a song' })).toBeOnTheScreen();
  });
});

describe('retell (B3)', () => {
  it('lane widths follow 60 / 45 / 30 s; a finished round shows its words and pauses', async () => {
    await renderStory(fx.b3);
    const retell = fx.b3.screen?.kind === 'retell' ? fx.b3.screen : null;
    expect(laneLengths(retell as NonNullable<typeof retell>)).toEqual([60000, 45000, 30000]);
    expect(flat(screen.getByTestId('retell-lane-0-track').props.style).width).toBe('100.00%');
    expect(flat(screen.getByTestId('retell-lane-1-track').props.style).width).toBe('75.00%');
    expect(flat(screen.getByTestId('retell-lane-2-track').props.style).width).toBe('50.00%');
    const round1 = retell?.results[0];
    expect(screen.getAllByTestId('retell-lane-0-word')).toHaveLength(round1?.tiles.length ?? -1);
    expect(screen.getAllByTestId('retell-lane-0-pause')).toHaveLength(round1?.pauses.length ?? -1);
    expect(round1?.pauses.length).toBe(5);
    expect(screen.getByText('5 pauses')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('retell-lane-1-word')).toHaveLength(0);
    expect(screen.getByText('Round 2 · 45 seconds · now')).toBeOnTheScreen();
    expect(screen.getByTestId('story-meta')).toHaveTextContent('Retell · round 2 of 3');
    expect(screen.getByTestId('retell-wpm')).toHaveTextContent(`${Math.round(round1?.wordsPerMinute ?? 0)}words a minute`);
    expect(screen.getByTestId('retell-covered')).toHaveTextContent(`You used ${round1?.covered} of the scene’s ${round1?.total} words.`);
  });

  it('counts the lane down while listening, and Finish ends the round', async () => {
    jest.useFakeTimers();
    try {
      const { actions } = await renderStory(fx.b3);
      expect(screen.getByTestId('retell-countdown')).toHaveTextContent(/0:45/);
      expect(screen.getByTestId('retell-say-listo')).toHaveTextContent('Keep talking. Say Listo when you finish.');
      await fireEvent.press(screen.getByRole('button', { name: 'Finish this round' }));
      expect(actions.holdEnd).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('after three rounds: first round against the latest', async () => {
    const { actions } = await renderStory(fx.retell);
    const done = fx.retell.screen?.kind === 'retell' ? fx.retell.screen : null;
    const p = done?.progress;
    expect(p?.rounds).toBe(3);
    expect(screen.getByTestId('retell-wpm')).toHaveTextContent(`${p?.wordsPerMinute.from} → ${p?.wordsPerMinute.to}words a minute`);
    expect(screen.getByTestId('retell-pauses')).toHaveTextContent(`${p?.pauses.from} → ${p?.pauses.to}`, { exact: false });
    await fireEvent.press(screen.getByRole('button', { name: 'Next chapter' }));
    expect(actions.next).toHaveBeenCalledTimes(1);
  });

  it('starts a round with a tap when not listening', async () => {
    const { actions } = await renderStory({ ...fx.b3, listen: { phase: 'idle' } });
    await fireEvent.press(screen.getByRole('button', { name: 'Start this round' }));
    expect(actions.holdBegin).toHaveBeenCalledTimes(1);
    expect(actions.holdStart).toHaveBeenCalledTimes(1);
  });
});

describe('register switching', () => {
  it('shows the line, the registers, the swaps and, after the answer, what was understood', async () => {
    await renderStory(fx.register);
    const task = fx.register.screen?.kind === 'register' ? fx.register.screen.task : null;
    expect(screen.getByTestId('register-from-to')).toHaveTextContent(task?.to === 'neutral' ? 'Street → Neutral' : 'Neutral → Street');
    expect(screen.getByTestId('register-prompt')).toHaveTextContent(task?.prompt ?? '');
    expect(screen.getByTestId('register-swap-0')).toBeOnTheScreen();
    expect(screen.getByText(`Words understood: ${task?.result?.understood} of ${task?.result?.total}`)).toBeOnTheScreen();
    expect(screen.getByTestId('register-expected')).toHaveTextContent(task?.expected ?? '');
  });
});

describe('other screens', () => {
  it('placement done: the vocabulary estimate and Continue', async () => {
    const { actions } = await renderStory(fx.placementDone);
    expect(screen.getByText('Your level is set')).toBeOnTheScreen();
    expect(screen.getByTestId('placement-vocabulary')).toHaveTextContent('~1850 words');
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(actions.next).toHaveBeenCalledTimes(1);
  });

  it('error: the engine message and Try again (next)', async () => {
    const { actions } = await renderStory(fx.error);
    expect(screen.getByText('No sentence is ready yet. Try again in a moment.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(actions.next).toHaveBeenCalledTimes(1);
  });

  it('idle: Start', async () => {
    const { actions } = await renderStory(fx.idle);
    await fireEvent.press(screen.getByRole('button', { name: 'Start the story' }));
    expect(actions.start).toHaveBeenCalledTimes(1);
  });

  it('loading (null screen): a calm, named progress state', async () => {
    await renderStory(fx.loading);
    expect(screen.getByRole('progressbar', { name: 'Getting your story ready…' })).toBeOnTheScreen();
  });

  it('busy: a quiet spinner that leaves the commands working', async () => {
    const { actions } = await renderStory(fx.busy);
    expect(screen.getByLabelText('One moment…')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Otra vez, again' }));
    expect(actions.command).toHaveBeenCalledWith('again');
  });

  it('canned mode: a small note that the model is on its way, not an error', async () => {
    await renderStory(fx.options);
    expect(screen.getByTestId('story-canned')).toHaveTextContent('The language model is still on its way. Until then the story uses starter sentences.');
    expect(screen.queryByTestId('story-error')).toBeNull();
  });
});

describe('meaning sheet and notice', () => {
  it('shows the meaning and closes', async () => {
    const { actions } = await renderStory(fx.meaning);
    expect(screen.getByTestId('meaning-translation')).toHaveTextContent('Then she saw a note on the door and began to read it aloud.', { exact: false });
    await fireEvent.press(screen.getByTestId('meaning-close'));
    expect(actions.closeMeaning).toHaveBeenCalledTimes(1);
  });

  it('shows a word, its gloss and a false-friend warning', async () => {
    await renderStory({ ...fx.b2, meaning: { word: 'embarazada', key: 'es:embarazado', gloss: 'pregnant', falseFriend: 'Not "embarrassed".' } });
    expect(screen.getByTestId('meaning-word')).toHaveTextContent('embarazada');
    expect(screen.getByTestId('meaning-gloss')).toHaveTextContent('pregnant');
    expect(screen.getByTestId('meaning-false-friend')).toHaveTextContent('Looks like English, but isn’tNot "embarrassed".');
  });

  it('shows a notice once and dismisses it', async () => {
    const { actions } = await renderStory(fx.notice);
    await fireEvent.press(screen.getByTestId('story-notice'));
    expect(actions.dismissNotice).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Speech recognition is not available on this device. You can type instead.')).toBeOnTheScreen();
  });
});

describe('report this sentence', () => {
  it.each(['main', 'b1', 'b2', 'a2', 'noSe', 'nativeReply', 'turn', 'repairAnswer'] as const)('%s offers it under the screen and calls the action', async (name) => {
    const { actions } = await renderStory(fx[name]);
    const link = screen.getByRole('button', { name: 'Report this sentence' });
    expect(link.props.accessibilityHint).toBe('Opens your email app with this sentence, to tell us what is wrong with it');
    await fireEvent.press(link);
    expect(actions.reportSentence).toHaveBeenCalledTimes(1);
  });

  it.each(['upNext', 'retell', 'b3', 'register', 'placementDone', 'error', 'idle', 'loading'] as const)('%s has no sentence to report', async (name) => {
    await renderStory(fx[name]);
    expect(screen.queryByTestId('story-report')).toBeNull();
  });

  it('is absent when the controller does not offer it', async () => {
    const { reportSentence: _unused, ...actions } = mockStoryActions();
    await renderStory(fx.b1, actions as ReturnType<typeof mockStoryActions>);
    expect(screen.queryByTestId('story-report')).toBeNull();
  });

  it('shows the thanks notice the controller publishes', async () => {
    await renderStory({ ...fx.b1, notice: { key: 'story.notice.reported' } });
    expect(screen.getByTestId('story-notice')).toHaveTextContent(/Thanks, sent to your email app\./);
  });

  it('asks about the same screens as the controller', () => {
    const screens = STORY_FIXTURE_NAMES.map((n) => fx[n].screen).filter((s) => s !== null);
    for (const s of screens) {
      const withSentence = s.kind !== 'nativeReply' || s.sentence !== undefined;
      expect({ kind: s.kind, shows: showsReportableSentence(s) }).toEqual({ kind: s.kind, shows: REPORTABLE_KINDS.has(s.kind) && withSentence });
    }
  });
});

describe('text mode pill', () => {
  it('cycles auto, all tiles / all text, auto', () => {
    expect(nextTextMode('auto', true)).toBe('all_tiles');
    expect(nextTextMode('auto', false)).toBe('all_text');
    expect(nextTextMode('all_tiles', true)).toBe('all_text');
    expect(nextTextMode('all_text', true)).toBe('auto');
  });
});
