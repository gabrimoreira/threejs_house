import { Emitter } from '../utils/emitter';

/** O que o jogador mudou num cômodo em relação à planta original. */
export interface RoomOverride {
  piso?: string;
  corParede?: string;
}

/**
 * Personalizações da casa (piso e pintura por cômodo), separadas da planta.
 * Vão para o save junto com os itens; a Fase 6 usa isto para repintar a casa.
 */
export class HouseState extends Emitter<{ changed: string | null }> {
  private overrides: Record<string, RoomOverride> = {};

  get(roomId: string): RoomOverride {
    return { ...this.overrides[roomId] };
  }

  set(roomId: string, patch: RoomOverride): void {
    this.overrides[roomId] = { ...this.overrides[roomId], ...patch };
    this.emit('changed', roomId);
  }

  /** Cópia de tudo, para salvar. */
  snapshot(): Record<string, RoomOverride> {
    return structuredClone(this.overrides);
  }

  /** Troca tudo de uma vez (ao abrir um save). `changed` com null = todos os cômodos. */
  replace(all: Record<string, RoomOverride>): void {
    this.overrides = structuredClone(all);
    this.emit('changed', null);
  }
}
