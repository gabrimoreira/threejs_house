import type { Editor } from '../editor/editor';
import type { History } from '../editor/commands/History';
import type { WallView, WallViewMode } from '../house/wallView';

interface ToolbarOptions {
  /** Botões de ícone ao lado do título: desfazer, refazer, casas. */
  container: HTMLElement;
  /** Linha de baixo: modo das paredes e 1ª pessoa. */
  viewContainer: HTMLElement;
  editor: Editor;
  history: History;
  wallView: WallView;
  /** Esconde o botão de 1ª pessoa em telas de toque (sem Pointer Lock). */
  firstPersonAvailable: boolean;
  onFirstPerson(): void;
  onOpenSaves(): void;
}

const NEXT_MODE: Record<WallViewMode, WallViewMode> = {
  cortadas: 'transparentes',
  transparentes: 'inteiras',
  inteiras: 'cortadas',
};

/** Avança o modo das paredes: cortadas → transparentes → inteiras → cortadas. */
export function cycleWallMode(wallView: WallView): void {
  wallView.setMode(NEXT_MODE[wallView.current]);
}

/**
 * Barra do HUD: desfazer/refazer (essenciais no celular, onde não há Ctrl+Z),
 * modo das paredes, passeio em 1ª pessoa e "Minhas casas".
 */
export function createToolbar(options: ToolbarOptions): void {
  const { container, viewContainer, editor, history, wallView, firstPersonAvailable, onFirstPerson, onOpenSaves } = options;
  container.innerHTML = `
    <button class="icon-button" data-action="undo" aria-label="Desfazer">↶</button>
    <button class="icon-button" data-action="redo" aria-label="Refazer">↷</button>
    <button class="icon-button" data-action="saves" aria-label="Minhas casas" title="Minhas casas: salvar, abrir, exportar (Ctrl+S salva)">☰</button>`;
  viewContainer.innerHTML = `
    <button class="tool" data-action="walls" title="Paredes entre a câmera e o cômodo (V)"></button>
    ${firstPersonAvailable ? '<button class="tool" data-action="first-person" title="Andar pela casa em 1ª pessoa (F)">1ª pessoa</button>' : ''}`;
  const undo = container.querySelector<HTMLButtonElement>('[data-action="undo"]')!;
  const redo = container.querySelector<HTMLButtonElement>('[data-action="redo"]')!;
  const walls = viewContainer.querySelector<HTMLButtonElement>('[data-action="walls"]')!;

  const onClick = (event: MouseEvent) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'undo') editor.undo();
    if (action === 'redo') editor.redo();
    if (action === 'walls') cycleWallMode(wallView);
    if (action === 'first-person') onFirstPerson();
    if (action === 'saves') onOpenSaves();
  };
  container.addEventListener('click', onClick);
  viewContainer.addEventListener('click', onClick);

  const refresh = () => {
    undo.disabled = history.undoLabel === null;
    redo.disabled = history.redoLabel === null;
    undo.title = history.undoLabel ? `Desfazer: ${history.undoLabel} (Ctrl+Z)` : 'Nada para desfazer';
    redo.title = history.redoLabel ? `Refazer: ${history.redoLabel} (Ctrl+Y)` : 'Nada para refazer';
  };
  history.on('changed', refresh);
  refresh();

  const showWalls = (mode: WallViewMode) => (walls.textContent = `Paredes: ${mode}`);
  wallView.on('mode', showWalls);
  showWalls(wallView.current);
}
