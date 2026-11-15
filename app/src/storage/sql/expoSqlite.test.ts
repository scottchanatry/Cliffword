import { createFakeExpoSqlite } from '../testing/fakeExpoSqlite';
import { describeSqlDatabaseContract } from '../testing/sqlContract';
import { fromExpoSqlite } from './expoSqlite';

describeSqlDatabaseContract('expo-sqlite driver', async () => fromExpoSqlite(await createFakeExpoSqlite()));

describe('expo-sqlite driver', () => {
  it('maps each call to the SDK 58 async API', async () => {
    const connection = await createFakeExpoSqlite();
    const db = fromExpoSqlite(connection);
    await db.exec('CREATE TABLE t (x INTEGER)');
    await db.run('INSERT INTO t VALUES (?)', [1]);
    await db.all('SELECT x FROM t');
    await db.get('SELECT x FROM t');
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t VALUES (?)', [2]);
    });
    await db.close();
    expect(connection.calls).toEqual([
      'execAsync',
      'runAsync',
      'getAllAsync',
      'getFirstAsync',
      'withTransactionAsync',
      'runAsync',
      'closeAsync',
    ]);
    expect(connection.closed).toBe(true);
  });

  it('accepts a real expo-sqlite SQLiteDatabase type', () => {
    type Real = import('expo-sqlite').SQLiteDatabase;
    type Fits = Real extends import('./expoSqlite').ExpoSqliteConnection ? true : false;
    const fits: Fits = true;
    expect(fits).toBe(true);
  });
});
