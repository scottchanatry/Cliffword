import { FakeClock } from '../../adapters/clock/FakeClock';
import { FakeHaptics } from '../../adapters/haptics/FakeHaptics';
import { FakeSpeechIn } from '../../adapters/speechIn/FakeSpeechIn';
import { FakeSpeechOut } from '../../adapters/speechOut/FakeSpeechOut';
import type { FinalTranscript } from '../../adapters/speechIn/types';
import { defaultPacks } from '../../services/defaults';
import type { ListenState } from '../contract';
import { HoldToSpeak, LISTEN_IDLE } from './hold';
import { listenOptionsFor } from './listen';
import { SerialQueue } from './queue';
import { Speaker } from './speaker';
import { typedTranscript, utteranceOf } from './utterance';

const { lang } = defaultPacks();

describe('SerialQueue', () => {
  it('runs jobs one at a time in order, reports busy, and goes on after a failure', async () => {
    const busy: boolean[] = [];
    const errors: unknown[] = [];
    const q = new SerialQueue({ onBusy: (b) => busy.push(b), onError: (e) => errors.push(e) });
    const order: string[] = [];
    const a = q.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('a');
      return 1;
    }, true);
    const b = q.enqueue(() => {
      throw new Error('boom');
    });
    const c = q.enqueue(() => {
      order.push('c');
      return 3;
    }, true);
    expect(await Promise.all([a, b, c])).toEqual([1, undefined, 3]);
    await q.idle();
    expect(order).toEqual(['a', 'c']);
    expect(busy).toEqual([true, false]);
    expect(errors).toHaveLength(1);
    q.close();
    expect(await q.enqueue(() => 4)).toBeUndefined();
  });
});

describe('Speaker', () => {
  it('picks the voice of the first region, and a newer say supersedes the one before', async () => {
    const speechOut = new FakeSpeechOut({ autoFinish: false });
    const s = new Speaker({ speechOut, pack: lang, regions: () => ['PR'] });
    const first = s.say('Esta noche', { rate: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(speechOut.lastCall).toMatchObject({ text: 'Esta noche', lang: 'es-PR', voice: 'fake.es-PR' });
    expect(speechOut.lastCall?.timings.map((t) => t.text)).toEqual(['Esta', 'noche']);
    const second = s.say('salimos', { rate: 0.8 });
    expect(await first).toBe('stopped');
    await new Promise((r) => setTimeout(r, 0));
    speechOut.finish();
    expect(await second).toBe('completed');
    s.stop();
    expect(s.speaking).toBe(false);
  });
});

describe('HoldToSpeak', () => {
  function setup() {
    const clock = new FakeClock();
    const speechIn = new FakeSpeechIn({ clock });
    let listen: ListenState = LISTEN_IDLE;
    const states: string[] = [];
    const finals: FinalTranscript[] = [];
    const before: string[] = [];
    const hold = new HoldToSpeak({
      speechIn,
      haptics: new FakeHaptics(),
      publish: (s) => {
        listen = s;
        states.push(s.phase);
      },
      current: () => listen,
      onFinal: async (t) => {
        finals.push(t);
      },
      beforeListen: () => {
        before.push('pause');
      },
      listenOptions: () => listenOptionsFor(lang, ['PR'], [], ['janguear']),
    });
    return { clock, speechIn, hold, states, finals, before, listen: () => listen };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('warms, runs beforeListen, listens with the hints, and sends the final', async () => {
    const h = setup();
    h.hold.begin();
    h.hold.start();
    await flush();
    expect(h.before).toEqual(['pause']);
    expect(h.speechIn.currentOptions).toMatchObject({ lang: 'es-PR', onDevice: true, continuous: true });
    expect(h.speechIn.currentOptions?.hints).toEqual(expect.arrayContaining(['janguear', 'otra vez']));
    h.speechIn.queueUtterance('janguear');
    h.hold.end();
    await flush();
    await flush();
    expect(h.finals.map((f) => f.text)).toEqual(['janguear']);
    // Release and the final each publish 'finishing'.
    expect(h.states.filter((x, i) => x !== h.states[i - 1])).toEqual(['warming', 'listening', 'finishing', 'idle']);
    expect(h.hold.active).toBe(false);
  });

  it('a release before listening is a tap; a cancel drops the utterance', async () => {
    const h = setup();
    h.hold.begin();
    h.hold.end();
    expect(h.listen()).toEqual(LISTEN_IDLE);
    h.hold.begin();
    h.hold.start();
    await flush();
    h.hold.cancel();
    expect(h.listen()).toEqual(LISTEN_IDLE);
    expect(h.finals).toEqual([]);
  });
});

describe('utterances', () => {
  it('credits spoken time for speech and none for typed answers', () => {
    expect(utteranceOf(typedTranscript('janguear'))).toEqual({ text: 'janguear', info: {}, credited: 0, typed: true });
    const spoken = utteranceOf({ text: 'janguear', durationMs: 1500, spokenMs: 1200, source: 'speech', words: [{ text: 'janguear', startMs: 100, endMs: 900 }] });
    expect(spoken.typed).toBe(false);
    expect(spoken.credited).toBeGreaterThan(0);
    expect(spoken.info.words).toEqual([{ text: 'janguear', startMs: 100, endMs: 900 }]);
  });
});
