/** Emissor de eventos tipado e mínimo: on() devolve a função para cancelar a inscrição. */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  protected emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    for (const fn of this.listeners.get(type) ?? []) (fn as (p: Events[K]) => void)(payload);
  }
}
