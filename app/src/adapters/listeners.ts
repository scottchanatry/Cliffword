/**
 * A small typed listener set shared by every adapter: `add` returns the function that removes
 * the listener, `emit` calls each listener with the value, in the order they were added.
 *
 * A listener added or removed during `emit` takes effect from the next `emit`. A listener that
 * throws does not stop the others; the first error is rethrown after all have run.
 */

/** Removes the listener it was returned for. Calling it twice is harmless. */
export type Unsubscribe = () => void;

export type Listener<T> = (value: T) => void;

export class Listeners<T> {
  private readonly set = new Set<Listener<T>>();

  add(listener: Listener<T>): Unsubscribe {
    // Wrap so the same function can be added twice and removed independently.
    const entry: Listener<T> = (value) => listener(value);
    this.set.add(entry);
    return () => {
      this.set.delete(entry);
    };
  }

  emit(value: T): void {
    let firstError: unknown;
    let failed = false;
    for (const listener of [...this.set]) {
      try {
        listener(value);
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
    if (failed) throw firstError;
  }

  clear(): void {
    this.set.clear();
  }

  get size(): number {
    return this.set.size;
  }
}
