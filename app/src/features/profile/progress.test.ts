import { LearnerModel } from '@cliffword/engine';
import { openTestStorage } from '../../storage/testing/openTestStorage';
import { clearProgress, deleteLyricsAndTexts, PROGRESS_TABLES } from './progress';

async function seeded() {
  const storage = await openTestStorage();
  const at = Date.UTC(2026, 10, 16, 12);
  const learner = new LearnerModel();
  await storage.learner.record(learner, [{ type: 'marked_known', key: 'es:mercado', at }]);
  await storage.learner.saveSnapshot(learner, at);
  await storage.sessions.save({ id: 'story-a', kind: 'story', version: 1, snapshot: { n: 1 } });
  await storage.sessions.save({ id: 'lyric:s1', kind: 'lyric', version: 1, snapshot: {}, active: false });
  const story = await storage.stories.create({ title: 'El mercado' });
  await storage.stories.putSentence(story.id, 0, 'Marta llegó tarde.', {});
  await storage.spokenTime.addUtterance(60_000, at);
  await storage.settings.update({ onboarded: true, register: 'street' });
  const song = await storage.songs.upsert({ source: 'manual', title: 'Luna de Santurce' });
  await storage.lyrics.put(song.id, 'Esta noche', {});
  const text = await storage.texts.add({ title: 'Nota', rawText: 'Una nota.' });
  await storage.modelFiles.upsert({ id: 'qwen3-1.7b-q4_k_m', path: '/m.gguf', status: 'ready' });
  return { storage, story, song, text };
}

const count = async (storage: Awaited<ReturnType<typeof openTestStorage>>, table: string) =>
  (await storage.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n ?? -1;

describe('your data', () => {
  it('clearProgress empties the learner, sessions, stories and minutes spoken, and keeps the rest', async () => {
    const { storage, song, text } = await seeded();
    await clearProgress(storage);
    for (const table of PROGRESS_TABLES) expect({ table, n: await count(storage, table) }).toEqual({ table, n: 0 });
    expect(await storage.settings.getAll()).toMatchObject({ onboarded: true, register: 'street' });
    expect(await storage.songs.get(song.id)).not.toBeNull();
    expect(await storage.lyrics.get(song.id)).not.toBeNull();
    expect(await storage.texts.get(text.id)).not.toBeNull();
    expect(await storage.modelFiles.get('qwen3-1.7b-q4_k_m')).not.toBeNull();
    expect(await storage.learner.latestSnapshot()).toBeNull();
    await storage.close();
  });

  it('deleteLyricsAndTexts removes lyrics, texts and their sessions, and keeps songs and stories', async () => {
    const { storage, song, story } = await seeded();
    await deleteLyricsAndTexts(storage);
    expect(await count(storage, 'lyrics')).toBe(0);
    expect(await count(storage, 'texts')).toBe(0);
    expect((await storage.sessions.list()).map((s) => s.id)).toEqual(['story-a']);
    expect(await storage.songs.get(song.id)).not.toBeNull();
    expect(await storage.stories.get(story.id)).not.toBeNull();
    expect(await storage.spokenTime.total()).toBe(60_000);
    await storage.close();
  });
});
