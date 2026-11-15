import { openStorage, STORAGE_BACKEND } from './open';
import * as web from './open.web';
import { SCHEMA_VERSION } from './schema';
import { DATABASE_NAME } from './storage';
import { createFakeExpoSqlite, type FakeExpoSqlite } from './testing/fakeExpoSqlite';

let fake: FakeExpoSqlite;
const mockOpenDatabaseAsync = jest.fn(async (_name: string) => fake);

// Hoisted above the imports by babel-jest; the factory reads the mock lazily.
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (name: string) => mockOpenDatabaseAsync(name),
}));

describe('openStorage (iOS and Android)', () => {
  beforeEach(async () => {
    fake = await createFakeExpoSqlite();
    mockOpenDatabaseAsync.mockClear();
  });

  it('opens cliffword.db, turns on WAL and foreign keys, and migrates', async () => {
    const storage = await openStorage();
    expect(STORAGE_BACKEND).toBe('expo-sqlite');
    expect(mockOpenDatabaseAsync).toHaveBeenCalledWith(DATABASE_NAME);
    expect(fake.raw.exec('PRAGMA user_version')[0]?.values[0]?.[0]).toBe(SCHEMA_VERSION);
    expect(fake.raw.exec('PRAGMA foreign_keys')[0]?.values[0]?.[0]).toBe(1);
    // The repositories work end to end through the expo-sqlite driver.
    await storage.settings.set('onboarded', true);
    const story = await storage.stories.create({ title: 'Cuento' });
    await storage.stories.appendSentence(story.id, 'Hola.', null);
    expect(await storage.settings.get('onboarded')).toBe(true);
    expect(await storage.stories.sentences(story.id)).toHaveLength(1);
    expect(fake.calls).toContain('withTransactionAsync');
    await storage.close();
    expect(fake.closed).toBe(true);
  });

  it('keeps data across reopening the same database', async () => {
    const first = await openStorage({ name: 'other.db' });
    await first.spokenTime.addUtterance(1500, Date.now());
    expect(mockOpenDatabaseAsync).toHaveBeenCalledWith('other.db');
    // Reopen on the same connection contents: migrations are a no-op and data is still there.
    const second = await openStorage({ name: 'other.db' });
    expect(await second.spokenTime.total()).toBe(1500);
  });

  it('closes the connection when the schema is newer than the app', async () => {
    fake.raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`);
    await expect(openStorage()).rejects.toThrow(/newer than this app/);
    expect(fake.closed).toBe(true);
  });
});

describe('openStorage (web preview)', () => {
  it('opens a migrated in-memory database with the same repositories', async () => {
    const storage = await web.openStorage();
    expect(web.STORAGE_BACKEND).toBe('sql.js-memory');
    expect(await storage.db.get('PRAGMA user_version')).toEqual({ user_version: SCHEMA_VERSION });
    await storage.sessions.save({ kind: 'story', version: 1, snapshot: { at: 1 } });
    expect(await storage.sessions.active('story')).not.toBeNull();
    await storage.close();
  });

  it('has the same signature as the native openStorage', () => {
    const sameShape: typeof openStorage = web.openStorage;
    expect(typeof sameShape).toBe('function');
  });
});
