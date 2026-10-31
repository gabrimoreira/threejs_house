import type { HouseData } from '../house/types';
import { getItem, getVariant } from '../catalog/catalog';
import type { RoomOverride } from './houseState';
import { newUid, type ItemState } from './world';
import { migrate, SAVE_VERSION } from './migrations';

/** Formato do save: o que vai para o IndexedDB e para o arquivo exportado. */
export interface SaveData {
  version: number;
  id: string;
  nome: string;
  atualizadoEm: string; // ISO 8601
  casa: { comodos: Record<string, RoomOverride> };
  itens: ItemState[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/**
 * Valida (e migra) um save vindo de fora: do IndexedDB ou de um arquivo importado.
 * Nunca confiamos no conteúdo: campos com tipo errado e itens desconhecidos são
 * descartados com um aviso, em vez de quebrar o jogo.
 */
export function parseSave(raw: unknown, house: HouseData): { save: SaveData; warnings: string[] } {
  if (typeof raw !== 'object' || raw === null || !isNum((raw as { version?: unknown }).version)) {
    throw new Error('Arquivo não parece um save do Casa Sandbox (falta "version").');
  }
  const data = migrate(raw as Record<string, unknown> & { version: number });
  const warnings: string[] = [];

  const itens: ItemState[] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(data.itens) ? data.itens : []) {
    const it = value as Partial<ItemState>;
    const catalogItem = typeof it.catalogId === 'string' ? getItem(it.catalogId) : undefined;
    if (!catalogItem) {
      warnings.push(`Item desconhecido ignorado: ${String(it.catalogId)}`);
      continue;
    }
    const pos = it.posicao;
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(isNum) || !isNum(it.rotacao)) {
      warnings.push(`Item com posição inválida ignorado: ${catalogItem.nome}`);
      continue;
    }
    let uid = typeof it.uid === 'string' && it.uid ? it.uid : newUid();
    if (seen.has(uid)) uid = newUid();
    seen.add(uid);
    const variant = getVariant(catalogItem, typeof it.variante === 'string' ? it.variante : '');
    if (variant.id !== it.variante) warnings.push(`Variante desconhecida em ${catalogItem.nome}: usando "${variant.nome}"`);
    itens.push({
      uid,
      catalogId: catalogItem.id,
      variante: variant.id,
      posicao: [pos[0], pos[1], pos[2]],
      rotacao: it.rotacao,
      comodo: typeof it.comodo === 'string' ? it.comodo : null,
      apoio: typeof it.apoio === 'string' ? it.apoio : null,
      parede: typeof it.parede === 'string' ? it.parede : null,
    });
  }
  // Um item apoiado em algo que não veio no arquivo passa a estar "no ar": soltamos o vínculo.
  for (const item of itens) {
    if (item.apoio && !seen.has(item.apoio)) item.apoio = null;
  }

  // Personalizações só para cômodos, pisos e cores que existem.
  const comodos: Record<string, RoomOverride> = {};
  const rawComodos = (data.casa as { comodos?: Record<string, RoomOverride> } | undefined)?.comodos ?? {};
  for (const room of house.comodos) {
    const o = rawComodos[room.id];
    if (!o) continue;
    const clean: RoomOverride = {};
    if (typeof o.piso === 'string' && house.pisos[o.piso]) clean.piso = o.piso;
    if (isColor(o.corParede)) clean.corParede = o.corParede;
    if (Object.keys(clean).length) comodos[room.id] = clean;
  }

  return {
    save: {
      version: SAVE_VERSION,
      id: typeof data.id === 'string' && data.id ? data.id : newUid(),
      nome: typeof data.nome === 'string' && data.nome.trim() ? data.nome.trim().slice(0, 60) : 'Casa sem nome',
      atualizadoEm: typeof data.atualizadoEm === 'string' ? data.atualizadoEm : new Date().toISOString(),
      casa: { comodos },
      itens,
    },
    warnings,
  };
}
