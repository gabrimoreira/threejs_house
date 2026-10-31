import type { Editor } from '../editor/editor';
import type { World } from '../state/world';
import type { ThumbnailService } from '../catalog/thumbnails';
import type { Room } from '../house/types';
import { getItem } from '../catalog/catalog';

interface InspectorOptions {
  root: HTMLElement;
  editor: Editor;
  world: World;
  thumbnails: ThumbnailService;
  rooms: Room[];
}

/**
 * Painel do item selecionado: troca de variante, rotação (botões e slider, que
 * também serve no celular, onde não há Shift+R) e ações de duplicar/excluir.
 */
export function createInspector({ root, editor, world, thumbnails, rooms }: InspectorOptions): HTMLElement {
  const panel = document.createElement('aside');
  panel.className = 'inspector';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="inspector-header">
      <div class="inspector-title"><strong></strong><span></span></div>
      <button class="icon-button" data-action="close" aria-label="Desmarcar">✕</button>
    </div>
    <div class="inspector-section">
      <h4>Variante</h4>
      <div class="variants compact"></div>
    </div>
    <div class="inspector-section">
      <h4>Rotação <output></output></h4>
      <div class="rotation-row">
        <button data-action="rotate-left" title="Girar -90°">⟲ 90°</button>
        <input type="range" min="0" max="359" step="1" aria-label="Rotação livre" />
        <button data-action="rotate-right" title="Girar +90° (R)">⟳ 90°</button>
      </div>
    </div>
    <div class="inspector-actions">
      <button data-action="duplicate" title="Duplicar (Ctrl+D)">Duplicar</button>
      <button data-action="delete" class="danger" title="Excluir (Delete)">Excluir</button>
    </div>`;
  root.append(panel);

  const name = panel.querySelector<HTMLElement>('.inspector-title strong')!;
  const subtitle = panel.querySelector<HTMLElement>('.inspector-title span')!;
  const variants = panel.querySelector<HTMLElement>('.variants')!;
  const slider = panel.querySelector<HTMLInputElement>('input[type="range"]')!;
  const degrees = panel.querySelector<HTMLOutputElement>('output')!;
  let renderedCatalogId: string | null = null;

  panel.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'close') editor.select(null);
    if (action === 'rotate-left') editor.rotateSelected(-90);
    if (action === 'rotate-right') editor.rotateSelected(90);
    if (action === 'duplicate') editor.duplicateSelected();
    if (action === 'delete') editor.deleteSelected();
  });

  // input = enquanto arrasta (prévia); change = soltou (grava no histórico).
  slider.addEventListener('input', () => {
    degrees.textContent = `${slider.value}°`;
    editor.setSelectedRotation(Number(slider.value), false);
  });
  slider.addEventListener('change', () => editor.setSelectedRotation(Number(slider.value), true));

  editor.on('selection', (uid) => {
    const state = uid ? world.get(uid) : undefined;
    const item = state ? getItem(state.catalogId) : undefined;
    panel.hidden = !state || !item;
    if (!state || !item) {
      renderedCatalogId = null;
      return;
    }
    const variant = item.variantes.find((v) => v.id === state.variante) ?? item.variantes[0];
    const room = rooms.find((r) => r.id === state.comodo);
    name.textContent = item.nome;
    subtitle.textContent = `${variant.nome}${room ? ` · ${room.nome}` : ''}`;
    slider.value = String(state.rotacao);
    degrees.textContent = `${state.rotacao}°`;

    // Recria as miniaturas só quando muda o tipo de item; senão, só marca a ativa.
    if (renderedCatalogId !== item.id) {
      renderedCatalogId = item.id;
      variants.replaceChildren(
        ...item.variantes.map((v) => {
          const button = document.createElement('button');
          button.className = 'variant';
          button.dataset.variant = v.id;
          button.title = v.gerada ? `${v.nome} (variante de cor gerada)` : v.nome;
          const img = document.createElement('img');
          img.alt = v.nome;
          img.width = img.height = 48;
          thumbnails.get(item, v).then((url) => (img.src = url)).catch(() => button.classList.add('broken'));
          button.append(img);
          button.addEventListener('click', () => void editor.changeSelectedVariant(v.id));
          return button;
        }),
      );
    }
    for (const button of variants.querySelectorAll<HTMLElement>('.variant')) {
      button.classList.toggle('active', button.dataset.variant === state.variante);
    }
  });
  return panel;
}
