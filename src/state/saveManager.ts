import type { HouseData } from '../house/types';
import type { History } from '../editor/commands/History';
import { Emitter } from '../utils/emitter';
import { debounce } from '../utils/debounce';
import { newUid, type World } from './world';
import type { HouseState } from './houseState';
import { parseSave, type SaveData } from './saveFormat';
import { SAVE_VERSION } from './migrations';
import { deleteSave, listSaves, readSave, writeSave, type SaveSummary } from './persistence';
import { loadPref, savePref } from './prefs';

export type SaveStatus = 'salvo' | 'pendente' | 'salvando' | 'erro';

type SaveEvents = {
  status: SaveStatus;
  /** Save aberto mudou (outro save, ou renomeado). */
  current: { id: string; nome: string };
  /** Avisos para o usuário (itens ignorados num import, erros...). */
  message: string;
};

const AUTOSAVE_DELAY = 1000;

/**
 * Persistência do jogo:
 * - autosave: cada alteração no mundo agenda uma gravação (debounce de 1 s);
 * - vários saves nomeados (novo, salvar como, abrir, renomear, excluir);
 * - exportar/importar o save como arquivo JSON.
 * O id do save aberto fica no localStorage para reabrir o mesmo ao recarregar.
 */
export class SaveManager extends Emitter<SaveEvents> {
  private readonly world: World;
  private readonly houseState: HouseState;
  private readonly history: History;
  private readonly house: HouseData;
  private current: { id: string; nome: string } = { id: '', nome: '' };
  /** Enquanto um save é aplicado no mundo, as mudanças não disparam autosave. */
  private applying = false;
  private readonly scheduleSave = debounce(() => void this.saveNow(), AUTOSAVE_DELAY);

  constructor(world: World, houseState: HouseState, history: History, house: HouseData) {
    super();
    this.world = world;
    this.houseState = houseState;
    this.history = history;
    this.house = house;

    const onChange = () => {
      if (this.applying || !this.current.id) return;
      this.emit('status', 'pendente');
      this.scheduleSave();
    };
    world.on('added', onChange);
    world.on('removed', onChange);
    world.on('changed', onChange);
    houseState.on('changed', onChange);

    // Ao trocar de aba ou fechar, grava o que estiver pendente.
    const flush = () => this.scheduleSave.flush();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  }

  get currentSave(): { id: string; nome: string } {
    return { ...this.current };
  }

  /** Abre o último save usado (ou o mais recente); se não houver nenhum, cria um vazio. */
  async init(): Promise<void> {
    try {
      const preferred = loadPref<string | null>('saveAtual', null);
      if (preferred && (await this.open(preferred, false))) return;
      const [latest] = await listSaves();
      if (latest && (await this.open(latest.id, false))) return;
    } catch (err) {
      console.warn('IndexedDB indisponível:', err);
      this.emit('message', 'Não foi possível acessar o armazenamento do navegador: a casa não será salva.');
    }
    await this.startNew('Minha casa');
  }

  list(): Promise<SaveSummary[]> {
    return listSaves();
  }

  /** Grava o estado atual no save aberto. */
  async saveNow(): Promise<boolean> {
    this.scheduleSave.cancel();
    if (!this.current.id) return false;
    this.emit('status', 'salvando');
    try {
      await writeSave(this.snapshot());
      this.emit('status', 'salvo');
      return true;
    } catch (err) {
      console.error(err);
      this.emit('status', 'erro');
      return false;
    }
  }

  /** Cria uma casa vazia e passa a editá-la. */
  async startNew(nome: string): Promise<void> {
    await this.saveNow();
    this.apply({ version: SAVE_VERSION, id: newUid(), nome, atualizadoEm: new Date().toISOString(), casa: { comodos: {} }, itens: [] });
    await this.saveNow();
  }

  /** Copia o estado atual para um save novo, que passa a ser o aberto. */
  async saveAs(nome: string): Promise<void> {
    await this.saveNow();
    this.current = { id: newUid(), nome };
    this.emit('current', this.currentSave);
    savePref('saveAtual', this.current.id);
    await this.saveNow();
  }

  /** Abre um save. Devolve false se ele não existir ou estiver corrompido. */
  async open(id: string, saveCurrentFirst = true): Promise<boolean> {
    if (saveCurrentFirst) await this.saveNow();
    const raw = await readSave(id);
    if (!raw) return false;
    try {
      const { save, warnings } = parseSave(raw, this.house);
      this.apply(save);
      if (warnings.length) this.emit('message', `${warnings.length} aviso(s) ao abrir: ${warnings[0]}`);
      return true;
    } catch (err) {
      this.emit('message', `Não foi possível abrir o save: ${(err as Error).message}`);
      return false;
    }
  }

  async rename(id: string, nome: string): Promise<void> {
    if (id === this.current.id) {
      this.current = { ...this.current, nome };
      this.emit('current', this.currentSave);
      await this.saveNow();
      return;
    }
    const raw = await readSave(id);
    if (!raw) return;
    const { save } = parseSave(raw, this.house);
    await writeSave({ ...save, nome });
  }

  /** Exclui um save. Se for o aberto, abre outro (ou começa uma casa nova). */
  async remove(id: string): Promise<void> {
    await deleteSave(id);
    if (id !== this.current.id) return;
    this.current = { id: '', nome: '' }; // não regravar o save que acabou de ser excluído
    const [next] = await listSaves();
    if (!next || !(await this.open(next.id, false))) await this.startNew('Minha casa');
  }

  /** Baixa o save aberto como arquivo .json. */
  exportCurrent(): void {
    const save = this.snapshot();
    const blob = new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(save.nome) || 'casa'}.casa.json`;
    a.click();
    // Dá tempo do navegador iniciar o download antes de liberar a URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Importa um arquivo como um save NOVO (nunca sobrescreve os existentes) e o abre. */
  async importFile(file: File): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      this.emit('message', 'O arquivo não é um JSON válido.');
      return;
    }
    try {
      const { save, warnings } = parseSave(raw, this.house);
      await this.saveNow();
      this.apply({ ...save, id: newUid(), atualizadoEm: new Date().toISOString() });
      await this.saveNow();
      const extra = warnings.length ? ` (${warnings.length} aviso(s): ${warnings[0]})` : '';
      this.emit('message', `"${save.nome}" importada com ${save.itens.length} itens${extra}.`);
    } catch (err) {
      this.emit('message', `Não foi possível importar: ${(err as Error).message}`);
    }
  }

  private snapshot(): SaveData {
    return {
      version: SAVE_VERSION,
      id: this.current.id,
      nome: this.current.nome,
      atualizadoEm: new Date().toISOString(),
      casa: { comodos: this.houseState.snapshot() },
      itens: this.world.all(),
    };
  }

  /** Coloca um save no mundo: itens, personalizações da casa e histórico zerado. */
  private apply(save: SaveData): void {
    this.applying = true;
    try {
      this.world.replaceAll(save.itens);
      this.houseState.replace(save.casa.comodos);
    } finally {
      this.applying = false;
    }
    this.history.clear(); // desfazer não deve atravessar a troca de save
    this.current = { id: save.id, nome: save.nome };
    savePref('saveAtual', save.id);
    this.emit('current', this.currentSave);
    this.emit('status', 'salvo');
  }
}

/** Nome de arquivo seguro: "Minha Casa!" → "minha-casa". */
function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
