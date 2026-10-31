import type { ItemState, World } from '../../state/world';
import type { Command } from './Command';

export type ItemPatch = Partial<Omit<ItemState, 'uid'>>;

/** Adiciona itens (posicionar do catálogo, duplicar). Desfazer remove os mesmos uids. */
export class AddItems implements Command {
  readonly label: string;
  private readonly world: World;
  private readonly items: ItemState[];

  constructor(world: World, items: ItemState[], label: string) {
    this.world = world;
    this.items = items;
    this.label = label;
  }

  do(): void {
    for (const item of this.items) this.world.add(item);
  }

  undo(): void {
    for (const item of this.items) this.world.remove(item.uid);
  }
}

/** Remove itens. Guarda uma cópia de cada um para desfazer devolvê-los iguais (mesmo uid). */
export class RemoveItems implements Command {
  readonly label: string;
  private readonly world: World;
  private readonly items: ItemState[];

  constructor(world: World, items: ItemState[], label: string) {
    this.world = world;
    this.items = items;
    this.label = label;
  }

  do(): void {
    for (const item of this.items) this.world.remove(item.uid);
  }

  undo(): void {
    for (const item of this.items) this.world.add(item);
  }
}

export interface ItemChange {
  uid: string;
  before: ItemPatch;
  after: ItemPatch;
}

/**
 * Altera campos de um ou mais itens: mover, girar, trocar variante.
 * Guarda só os campos que mudaram, antes e depois.
 */
export class UpdateItems implements Command {
  readonly label: string;
  private readonly world: World;
  private readonly changes: ItemChange[];

  constructor(world: World, changes: ItemChange[], label: string) {
    this.world = world;
    this.changes = changes;
    this.label = label;
  }

  do(): void {
    for (const c of this.changes) this.world.update(c.uid, c.after);
  }

  undo(): void {
    for (const c of [...this.changes].reverse()) this.world.update(c.uid, c.before);
  }
}

/** Monta um UpdateItems para um item, lendo os valores "antes" do estado atual. */
export function updateItem(world: World, uid: string, after: ItemPatch, label: string): UpdateItems {
  const current = world.get(uid);
  if (!current) throw new Error(`Item ${uid} não existe`);
  const before: ItemPatch = {};
  for (const key of Object.keys(after) as (keyof ItemPatch)[]) {
    (before as Record<string, unknown>)[key] = current[key];
  }
  return new UpdateItems(world, [{ uid, before, after }], label);
}
