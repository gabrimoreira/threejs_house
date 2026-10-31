import { createStore, del, get, set, values } from 'idb-keyval';
import type { SaveData } from './saveFormat';

/**
 * Saves no IndexedDB, via idb-keyval (um key-value simples por cima da API do
 * IndexedDB). Cada save fica numa chave = id. O banco é separado do das miniaturas
 * porque o createStore do idb-keyval usa um object store por banco.
 */
const store = createStore('casa-sandbox-saves', 'saves');

export interface SaveSummary {
  id: string;
  nome: string;
  atualizadoEm: string;
  quantidade: number;
}

/** Saves do mais recente para o mais antigo. */
export async function listSaves(): Promise<SaveSummary[]> {
  const all = (await values(store)) as SaveData[];
  return all
    .map((s) => ({ id: s.id, nome: s.nome, atualizadoEm: s.atualizadoEm, quantidade: s.itens?.length ?? 0 }))
    .sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm));
}

/** Lê o save cru (ainda precisa passar por parseSave). */
export function readSave(id: string): Promise<unknown> {
  return get(id, store);
}

export function writeSave(save: SaveData): Promise<void> {
  return set(save.id, save, store);
}

export function deleteSave(id: string): Promise<void> {
  return del(id, store);
}
