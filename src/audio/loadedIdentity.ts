/**
 * What the engine last loaded into each stage, by the same id a preset stores
 * (a bundled URL or `upload:<name>`).
 *
 * The worklet answers each load over one message port, in the order they were
 * sent, so replies are paired with sends first in, first out. A rejected load
 * changes nothing: the engine keeps the model it had, and so does this.
 */
export class LoadedIdentity {
  private nam = new Map<number, string>();
  private namPending = new Map<number, string[]>();
  private cab: string | null = null;
  private cabPending: string[] = [];

  expectNam(slot: number, identity: string): void {
    const queue = this.namPending.get(slot) ?? [];
    queue.push(identity);
    this.namPending.set(slot, queue);
  }

  namReply(slot: number, ok: boolean): void {
    const identity = this.namPending.get(slot)?.shift();
    if (ok && identity !== undefined) this.nam.set(slot, identity);
  }

  expectCab(identity: string): void {
    this.cabPending.push(identity);
  }

  cabReply(ok: boolean): void {
    const identity = this.cabPending.shift();
    if (ok && identity !== undefined) this.cab = identity;
  }

  /** True while a load for this stage has been sent and not yet answered. */
  hasNamPending(slot: number): boolean {
    return (this.namPending.get(slot)?.length ?? 0) > 0;
  }

  hasCabPending(): boolean {
    return this.cabPending.length > 0;
  }

  loadedNam(slot: number): string | null {
    return this.nam.get(slot) ?? null;
  }

  loadedCab(): string | null {
    return this.cab;
  }
}
