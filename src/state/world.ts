import { Emitter } from '../utils/emitter';

export type Vec3 = [number, number, number];

/** Um móvel posicionado na casa. É exatamente o que vai para o save. */
export interface ItemState {
  uid: string;
  catalogId: string;
  variante: string;
  posicao: Vec3; // centro da base, em metros
  rotacao: number; // graus em torno de Y
  comodo: string | null;
}

type WorldEvents = {
  added: ItemState;
  removed: ItemState;
  changed: { before: ItemState; after: ItemState };
};

/** Id curto e único. (crypto.randomUUID só existe em contexto seguro; no celular via IP da rede local não.) */
export function newUid(): string {
  return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 8);
}

/**
 * Estado do mundo: a fonte da verdade do jogo. A cena 3D (WorldView) só reflete
 * o que está aqui. Os itens são tratados como imutáveis: update() troca o objeto
 * inteiro, o que facilita desfazer e salvar.
 */
export class World extends Emitter<WorldEvents> {
  private items = new Map<string, ItemState>();

  all(): ItemState[] {
    return [...this.items.values()];
  }

  get(uid: string): ItemState | undefined {
    return this.items.get(uid);
  }

  add(item: ItemState): void {
    this.items.set(item.uid, item);
    this.emit('added', item);
  }

  remove(uid: string): ItemState | undefined {
    const item = this.items.get(uid);
    if (!item) return undefined;
    this.items.delete(uid);
    this.emit('removed', item);
    return item;
  }

  update(uid: string, patch: Partial<Omit<ItemState, 'uid'>>): ItemState | undefined {
    const before = this.items.get(uid);
    if (!before) return undefined;
    const after = { ...before, ...patch };
    this.items.set(uid, after);
    this.emit('changed', { before, after });
    return after;
  }
}
