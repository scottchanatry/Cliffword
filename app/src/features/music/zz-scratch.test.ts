import { LearnerModel, LyricSession, parseLyrics, createMockModel, surpriseMap, slangNotes, registerPairs } from '@cliffword/engine';
import { defaultPacks, sharedMockModel } from '../../services/defaults';

const LYRICS = `[Verso 1]
Esta noche salimos a janguear,
el corillo ya 'tá listo pa' janguear.
La luna de Santurce brilla en el mar,
y nadie se quiere ir pa' la casa.

[Coro]
Wepa, que suene el perreo,
mi pana trae los chavos y la guagua.
(Dale, dale)
La calle 'tá brutal, puñeta, qué calor,
bailamos hasta que salga el sol.`;

it('explores', async () => {
  const { lang, pair } = defaultPacks();
  const lyrics = parseLyrics(LYRICS, lang);
  console.log(JSON.stringify(lyrics.lines.map((l) => [l.index, l.text, l.adlib]), null, 0));
  console.log(JSON.stringify(lyrics.removed));
  const learner = new LearnerModel({ prior: (key: string, skill: string) => (skill === 'speaking' ? 0.1 : 0.5) } as never);
  const s = LyricSession.create({ model: null, pack: lang, pair, learner, now: 0, seed: 7, source: { kind: 'lyrics', lyrics }, song: { title: 'Luna de Santurce', artist: 'Rayo K.' }, settings: { register: 'street', regions: ['PR'] } });
  console.log(JSON.stringify(s.screen, null, 1).slice(0, 4000));
  let st = await s.next(1);
  console.log('NEXT1', JSON.stringify(st.screen), JSON.stringify(st.speak));
  st = await s.next(2);
  console.log('NEXT2', JSON.stringify(st.screen), JSON.stringify(st.speak));
  st = await s.handleUtterance('janguear', 3, { durationMs: 1200 });
  console.log('ANS', JSON.stringify(st.screen));
  st = s.startEcho(4);
  console.log('ECHO0', JSON.stringify(st.screen));
  st = await s.handleUtterance('el corillo ya está listo para janguear', 5, { durationMs: 2000 });
  console.log('ECHO1', JSON.stringify(st.screen));
  st = s.setRegister('street', 6);
  console.log('REG', JSON.stringify(st.screen));
  const m = sharedMockModel();
  const s2 = LyricSession.create({ model: m, pack: lang, pair, learner, now: 0, seed: 7, source: { kind: 'lyrics', lyrics }, settings: { register: 'neutral', regions: ['PR'], showExplicit: false } });
  console.log('READ-NOEXPL', JSON.stringify((s2.screen as any).lines.slice(7)));
  st = await s2.next(1); console.log('M1', JSON.stringify(st.screen));
  st = await s2.next(2); console.log('M2', JSON.stringify(st.screen));
  st = await s2.command('dont_know', 3); console.log('NOSE', JSON.stringify(st.screen));
  st = await s2.handleUtterance('janguear', 4, {}); console.log('NOSE2', JSON.stringify(st.screen));
}, 60000);
