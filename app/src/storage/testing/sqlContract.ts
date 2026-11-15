/**
 * The behaviour every SqlDatabase must have, as a Jest suite shared by the driver tests
 * (sql.js directly, and the expo-sqlite driver over a fake connection).
 */
import type { SqlDatabase } from '../sql/types';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function describeSqlDatabaseContract(name: string, open: () => Promise<SqlDatabase>): void {
  describe(`${name}: SqlDatabase contract`, () => {
    let db: SqlDatabase;

    beforeEach(async () => {
      db = await open();
      await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, s TEXT, n REAL, b BLOB); CREATE TABLE u (x INTEGER)');
    });

    afterEach(async () => {
      await db.close();
    });

    const count = async () => (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM t'))?.n;

    it('runs statements and reads rows with parameters', async () => {
      const first = await db.run('INSERT INTO t (s, n) VALUES (?, ?)', ['a', 1]);
      const second = await db.run('INSERT INTO t (s, n) VALUES (?, ?)', ['b', 2]);
      expect(first).toEqual({ changes: 1, lastInsertRowId: 1 });
      expect(second.lastInsertRowId).toBe(2);
      expect(await db.all('SELECT s, n FROM t ORDER BY id')).toEqual([
        { s: 'a', n: 1 },
        { s: 'b', n: 2 },
      ]);
      expect(await db.get('SELECT s FROM t WHERE n = ?', [2])).toEqual({ s: 'b' });
      expect(await db.get('SELECT s FROM t WHERE n = ?', [3])).toBeNull();
      expect(await db.all('SELECT s FROM t WHERE n > ?', [5])).toEqual([]);
      const updated = await db.run('UPDATE t SET n = n + 10');
      expect(updated.changes).toBe(2);
    });

    it('round-trips text with quotes and accents, big integers, floats, null and blobs', async () => {
      const text = `Mano, 'tá to' brutal; "¿qué?" ñ — it's \\ fine`;
      const at = 1_794_758_400_123;
      await db.run('INSERT INTO t (s, n, b) VALUES (?, ?, ?)', [text, at, new Uint8Array([0, 1, 255])]);
      await db.run('INSERT INTO t (s, n, b) VALUES (?, ?, ?)', [null, 0.25, null]);
      const rows = await db.all<{ s: string | null; n: number; b: Uint8Array | null }>('SELECT s, n, b FROM t ORDER BY id');
      expect(rows[0]?.s).toBe(text);
      expect(rows[0]?.n).toBe(at);
      expect(Array.from(rows[0]?.b ?? [])).toEqual([0, 1, 255]);
      expect(rows[1]).toEqual({ s: null, n: 0.25, b: null });
    });

    it('commits a transaction and returns its value', async () => {
      const value = await db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (s) VALUES (?)', ['x']);
        await tx.run('INSERT INTO t (s) VALUES (?)', ['y']);
        return (await tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM t'))?.n;
      });
      expect(value).toBe(2);
      expect(await count()).toBe(2);
    });

    it('rolls back a failed transaction and rejects with its error', async () => {
      await db.run('INSERT INTO t (s) VALUES (?)', ['kept']);
      const boom = new Error('boom');
      await expect(
        db.transaction(async (tx) => {
          await tx.run('INSERT INTO t (s) VALUES (?)', ['lost']);
          throw boom;
        }),
      ).rejects.toBe(boom);
      expect(await db.all('SELECT s FROM t')).toEqual([{ s: 'kept' }]);
    });

    it('rolls back when a statement inside the transaction fails', async () => {
      await expect(
        db.transaction(async (tx) => {
          await tx.run('INSERT INTO t (s) VALUES (?)', ['lost']);
          await tx.run('INSERT INTO no_such_table VALUES (1)');
        }),
      ).rejects.toThrow(/no_such_table/);
      expect(await count()).toBe(0);
    });

    it('joins nested transactions to the outer one', async () => {
      await expect(
        db.transaction(async (tx) => {
          await tx.transaction(async (inner) => {
            await inner.run('INSERT INTO t (s) VALUES (?)', ['inner']);
          });
          await tx.run('INSERT INTO t (s) VALUES (?)', ['outer']);
          throw new Error('outer fails');
        }),
      ).rejects.toThrow('outer fails');
      expect(await count()).toBe(0);
    });

    it('keeps calls made during a transaction out of it', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const failing = db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (s) VALUES (?)', ['in tx']);
        await gate;
        throw new Error('rolled back');
      });
      // Started while the transaction is open: must wait, and must survive its rollback.
      const outside = db.run('INSERT INTO u (x) VALUES (?)', [1]);
      const seen = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM t');
      await tick();
      release();
      await expect(failing).rejects.toThrow('rolled back');
      await outside;
      expect((await seen)?.n).toBe(0);
      expect(await db.all('SELECT x FROM u')).toEqual([{ x: 1 }]);
    });

    it('runs concurrent transactions one after another', async () => {
      const results = await Promise.all(
        [1, 2, 3].map((i) =>
          db.transaction(async (tx) => {
            await tx.run('INSERT INTO t (s) VALUES (?)', [`a${i}`]);
            await tick();
            await tx.run('INSERT INTO t (s) VALUES (?)', [`b${i}`]);
            return i;
          }),
        ),
      );
      expect(results).toEqual([1, 2, 3]);
      const rows = await db.all<{ s: string }>('SELECT s FROM t ORDER BY id');
      expect(rows.map((r) => r.s)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
    });

    it('refuses a transaction handle used after the transaction ended', async () => {
      const leaked = await db.transaction(async (tx) => tx);
      await expect(leaked.run('INSERT INTO t (s) VALUES (?)', ['late'])).rejects.toThrow(/finished/);
      expect(await count()).toBe(0);
    });

    it('keeps working after a failed statement', async () => {
      await expect(db.run('INSERT INTO nowhere VALUES (1)')).rejects.toThrow();
      await db.run('INSERT INTO t (s) VALUES (?)', ['ok']);
      expect(await count()).toBe(1);
    });

    it('rejects calls after close', async () => {
      await db.close();
      await expect(db.get('SELECT 1')).rejects.toThrow(/closed/);
      await db.close(); // closing twice is harmless
      db = await open(); // for afterEach
    });
  });
}
