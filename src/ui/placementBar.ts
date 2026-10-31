import type { Editor } from '../editor/editor';
import { isCoarsePointer } from '../scene/renderer';

/** Barra que aparece durante o posicionamento: o que está sendo colocado e os botões. */
export function createPlacementBar(root: HTMLElement, editor: Editor): void {
  const bar = document.createElement('div');
  bar.className = 'placement-bar';
  bar.hidden = true;
  bar.innerHTML = `
    <div class="placement-text">
      <span class="placement-label"></span>
      <span class="placement-hint"></span>
    </div>
    <div class="placement-actions">
      <button data-action="rotate" title="Girar 90° (R)">Girar</button>
      <button data-action="confirm" class="primary">Colocar</button>
      <button data-action="cancel" title="Cancelar (Esc)">Cancelar</button>
    </div>`;
  root.append(bar);

  const label = bar.querySelector<HTMLElement>('.placement-label')!;
  const hint = bar.querySelector<HTMLElement>('.placement-hint')!;
  const confirm = bar.querySelector<HTMLButtonElement>('[data-action="confirm"]')!;

  bar.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest('button')?.dataset.action;
    if (action === 'rotate') editor.rotatePlacement(90);
    if (action === 'confirm') editor.confirmPlacement();
    if (action === 'cancel') editor.cancelPlacement();
  });

  editor.on('placement', (status) => {
    bar.hidden = status === null;
    if (!status) return;
    label.textContent = `${status.item.nome} · ${status.variant.nome}`;
    if (!status.hasPosition) {
      hint.textContent = isCoarsePointer ? 'Toque no piso para posicionar' : 'Clique no piso · R gira · Shift+clique coloca vários · Esc cancela';
    } else if (!status.valid) {
      hint.textContent = 'Fora da casa: escolha outro lugar';
    } else {
      hint.textContent = isCoarsePointer ? 'Toque em "Colocar" para confirmar' : 'Clique para colocar · R gira · Esc cancela';
    }
    bar.classList.toggle('invalid', status.hasPosition && !status.valid);
    confirm.disabled = !status.hasPosition || !status.valid;
  });
}
