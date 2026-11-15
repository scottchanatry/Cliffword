import { describeSqlDatabaseContract } from '../testing/sqlContract';
import { loadSqlJs, openSqlJsDatabase } from './sqljs';

describeSqlDatabaseContract('sql.js', () => openSqlJsDatabase());

describe('sql.js loading', () => {
  it('loads the module once and opens independent in-memory databases', async () => {
    expect(await loadSqlJs()).toBe(await loadSqlJs());
    const a = await openSqlJsDatabase();
    const b = await openSqlJsDatabase();
    await a.exec('CREATE TABLE only_in_a (x)');
    expect(await b.all("SELECT name FROM sqlite_master WHERE name = 'only_in_a'")).toEqual([]);
    await Promise.all([a.close(), b.close()]);
  });

  it('opens a serialized database file', async () => {
    const SQL = await loadSqlJs();
    const source = new SQL.Database();
    source.exec("CREATE TABLE t (s TEXT); INSERT INTO t VALUES ('saved')");
    const db = await openSqlJsDatabase(source.export());
    source.close();
    expect(await db.all('SELECT s FROM t')).toEqual([{ s: 'saved' }]);
    await db.close();
  });
});
