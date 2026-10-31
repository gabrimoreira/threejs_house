/** Versão atual do formato do save. Aumente ao mudar o formato e escreva a migração. */
export const SAVE_VERSION = 1;

type AnySave = Record<string, unknown> & { version: number };

/**
 * Cada entrada transforma um save da versão N na versão N+1. Ao abrir um save
 * antigo, aplicamos os passos em sequência até chegar na versão atual, assim o
 * resto do código só precisa conhecer o formato mais novo.
 */
const migrations: Record<number, (save: AnySave) => AnySave> = {
  // v0 → v1: o estado dos protótipos (fases 2–4) não tinha os campos `casa`,
  // `apoio` e `parede`, nem metadados. Preenchemos com valores neutros.
  0: (save) => ({
    ...save,
    version: 1,
    nome: typeof save.nome === 'string' ? save.nome : 'Casa importada',
    casa: { comodos: {} },
    itens: (Array.isArray(save.itens) ? save.itens : []).map((item: Record<string, unknown>) => ({
      apoio: null,
      parede: null,
      ...item,
    })),
  }),
};

/** Leva um save de qualquer versão conhecida até SAVE_VERSION. */
export function migrate(raw: AnySave): AnySave {
  let save = raw;
  if (save.version > SAVE_VERSION) {
    throw new Error(`Este save é de uma versão mais nova do jogo (v${save.version}).`);
  }
  while (save.version < SAVE_VERSION) {
    const step = migrations[save.version];
    if (!step) throw new Error(`Não sei converter saves da versão ${save.version}.`);
    save = step(save);
  }
  return save;
}
