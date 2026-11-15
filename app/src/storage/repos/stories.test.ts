import { openTestStorage } from '../testing/openTestStorage';

describe('StoryRepo', () => {
  let storage: Awaited<ReturnType<typeof openTestStorage>>;
  beforeEach(async () => {
    storage = await openTestStorage();
  });
  afterEach(() => storage.close());

  it('creates, lists (newest first), renames and gets stories', async () => {
    const a = await storage.stories.create({ title: 'El mercado', createdAt: 1 });
    const b = await storage.stories.create({ title: 'La playa', createdAt: 2 });
    expect(a).toEqual({ id: 'id-1', title: 'El mercado', createdAt: 1 });
    expect((await storage.stories.list()).map((s) => s.id)).toEqual([b.id, a.id]);
    await storage.stories.rename(a.id, 'Marta en el mercado');
    expect(await storage.stories.get(a.id)).toEqual({ ...a, title: 'Marta en el mercado' });
    expect(await storage.stories.get('missing')).toBeNull();
  });

  it('appends sentences in order with their engine data', async () => {
    const story = await storage.stories.create({ title: 'Cuento' });
    const s0 = await storage.stories.appendSentence(story.id, 'Marta llegó tarde al mercado.', { targets: ['es:llegar'] });
    const s1 = await storage.stories.appendSentence(story.id, "Mano, 'tá to' brutal.", { cliff: { start: 6 } });
    expect([s0.idx, s1.idx]).toEqual([0, 1]);
    expect(await storage.stories.sentences(story.id)).toEqual([
      { storyId: story.id, idx: 0, text: 'Marta llegó tarde al mercado.', data: { targets: ['es:llegar'] } },
      { storyId: story.id, idx: 1, text: "Mano, 'tá to' brutal.", data: { cliff: { start: 6 } } },
    ]);
  });

  it('refuses sentences for a story that does not exist', async () => {
    await expect(storage.stories.appendSentence('ghost', 'Hola.', null)).rejects.toThrow(/No story/);
    await expect(storage.stories.putSentence('ghost', 0, 'Hola.', null)).rejects.toThrow(/FOREIGN KEY/);
  });

  it('replaces a sentence and truncates the end of a story', async () => {
    const story = await storage.stories.create({ title: 'Cuento' });
    for (const text of ['Uno.', 'Dos.', 'Tres.']) await storage.stories.appendSentence(story.id, text, null);
    await storage.stories.putSentence(story.id, 1, 'Dos, otra vez.', { regenerated: true });
    expect(await storage.stories.truncate(story.id, 2)).toBe(1);
    const texts = (await storage.stories.sentences(story.id)).map((s) => s.text);
    expect(texts).toEqual(['Uno.', 'Dos, otra vez.']);
    expect((await storage.stories.appendSentence(story.id, 'Tres otra vez.', null)).idx).toBe(2);
    await expect(storage.stories.putSentence(story.id, -1, 'x', null)).rejects.toThrow(/index/);
  });

  it('removes a story with its sentences', async () => {
    const story = await storage.stories.create({ title: 'Cuento' });
    await storage.stories.appendSentence(story.id, 'Uno.', null);
    await storage.stories.remove(story.id);
    expect(await storage.stories.get(story.id)).toBeNull();
    expect(await storage.stories.sentences(story.id)).toEqual([]);
  });
});
