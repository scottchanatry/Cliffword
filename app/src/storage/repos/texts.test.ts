import { openTestStorage } from '../testing/openTestStorage';

describe('TextRepo', () => {
  let storage: Awaited<ReturnType<typeof openTestStorage>>;
  beforeEach(async () => {
    storage = await openTestStorage();
  });
  afterEach(() => storage.close());

  it('adds, gets and lists texts, recently opened first', async () => {
    const a = await storage.texts.add({ title: ' La noticia ', rawText: 'El metro abre tarde. Nadie sabe por qué.', createdAt: 1 });
    expect(a).toEqual({ id: 'id-1', title: 'La noticia', rawText: 'El metro abre tarde. Nadie sabe por qué.', createdAt: 1, lastOpenedAt: null });
    const b = await storage.texts.add({ title: '', rawText: 'Otra cosa.', createdAt: 2 });
    expect((await storage.texts.list()).map((t) => t.id)).toEqual([b.id, a.id]);
    await storage.texts.markOpened(a.id, 5);
    expect((await storage.texts.list()).map((t) => t.id)).toEqual([a.id, b.id]);
    expect(await storage.texts.get(a.id)).toMatchObject({ lastOpenedAt: 5 });
    expect(await storage.texts.list(1)).toHaveLength(1);
  });

  it('refuses a blank text and removes texts', async () => {
    await expect(storage.texts.add({ title: 'x', rawText: '  \n ' })).rejects.toThrow(/text/);
    const t = await storage.texts.add({ title: 'x', rawText: 'Hola.' });
    await storage.texts.remove(t.id);
    expect(await storage.texts.get(t.id)).toBeNull();
  });
});
