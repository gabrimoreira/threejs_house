import type { Editor } from '../editor/editor';
import type { History } from '../editor/commands/History';

/**
 * Botões de desfazer/refazer (essenciais no celular, onde não há Ctrl+Z) e o
 * botão que abre "Minhas casas".
 */
export function createToolbar(container: HTMLElement, editor: Editor, history: History, onOpenSaves: () => void): void {
  container.innerHTML = `
    <button class="icon-button" data-action="undo" aria-label="Desfazer">↶</button>
    <button class="icon-button" data-action="redo" aria-label="Refazer">↷</button>
    <button class="icon-button" data-action="saves" aria-label="Minhas casas" title="Minhas casas: salvar, abrir, exportar (Ctrl+S salva)">☰</button>`;
  const undo = container.querySelector<HTMLButtonElement>('[data-action="undo"]')!;
  const redo = container.querySelector<HTMLButtonElement>('[data-action="redo"]')!;
  undo.addEventListener('click', () => editor.undo());
  redo.addEventListener('click', () => editor.redo());
  container.querySelector('[data-action="saves"]')!.addEventListener('click', onOpenSaves);

  const refresh = () => {
    undo.disabled = history.undoLabel === null;
    redo.disabled = history.redoLabel === null;
    undo.title = history.undoLabel ? `Desfazer: ${history.undoLabel} (Ctrl+Z)` : 'Nada para desfazer';
    redo.title = history.redoLabel ? `Refazer: ${history.redoLabel} (Ctrl+Y)` : 'Nada para refazer';
  };
  history.on('changed', refresh);
  refresh();
}
