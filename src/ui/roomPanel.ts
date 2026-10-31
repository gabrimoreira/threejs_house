import type { Editor } from '../editor/editor';
import type { HouseData } from '../house/types';
import type { HouseState, RoomOverride } from '../state/houseState';

interface RoomPanelOptions {
  root: HTMLElement;
  editor: Editor;
  house: HouseData;
  houseState: HouseState;
  /** Imagem (data URL) do padrão de um piso, ou null se for liso. */
  floorPreview(floorId: string): string | null;
  paint(roomId: string, patch: RoomOverride, label: string): void;
}

/** Cores prontas para as paredes, além do seletor livre. */
const PALETTE = ['#f7f5f0', '#ece4d6', '#f4efdf', '#f3d9d3', '#e8e3f2', '#dbe6ee', '#dcefe8', '#c9d8c5', '#d9d4c7', '#bfc8cf'];

/**
 * Painel do cômodo selecionado (clique no piso vazio): escolhe o piso e a cor das
 * paredes. Cada escolha vira um comando PaintRoom (desfazível) e entra no save.
 */
export function createRoomPanel({ root, editor, house, houseState, floorPreview, paint }: RoomPanelOptions): HTMLElement {
  const panel = document.createElement('aside');
  panel.className = 'inspector room-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="inspector-header">
      <div class="inspector-title"><strong></strong><span>Piso e pintura</span></div>
      <button class="icon-button" data-action="close" aria-label="Fechar">✕</button>
    </div>
    <div class="inspector-section">
      <h4>Piso</h4>
      <div class="swatches floors"></div>
    </div>
    <div class="inspector-section">
      <h4>Paredes</h4>
      <div class="swatches colors"></div>
      <label class="custom-color">Outra cor <input type="color" /></label>
    </div>`;
  root.append(panel);

  const title = panel.querySelector<HTMLElement>('.inspector-title strong')!;
  const floors = panel.querySelector<HTMLElement>('.floors')!;
  const colors = panel.querySelector<HTMLElement>('.colors')!;
  const picker = panel.querySelector<HTMLInputElement>('input[type="color"]')!;
  let roomId: string | null = null;

  // Botões de piso: miniatura do padrão desenhado no canvas (ou só a cor, se for liso).
  for (const [id, style] of Object.entries(house.pisos)) {
    const button = document.createElement('button');
    button.className = 'swatch floor-swatch';
    button.dataset.floor = id;
    button.title = style.nome;
    const preview = floorPreview(id);
    button.style.background = preview ? `url(${preview}) center / 200% ${style.cor}` : style.cor;
    button.innerHTML = `<span>${style.nome}</span>`;
    floors.append(button);
  }
  for (const hex of PALETTE) {
    const button = document.createElement('button');
    button.className = 'swatch color-swatch';
    button.dataset.color = hex;
    button.title = hex;
    button.style.background = hex;
    colors.append(button);
  }

  const roomName = () => house.comodos.find((r) => r.id === roomId)?.nome ?? '';

  panel.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!target) return;
    if (target.dataset.action === 'close') editor.selectRoom(null);
    if (!roomId) return;
    if (target.dataset.floor) paint(roomId, { piso: target.dataset.floor }, `Trocar piso: ${roomName()}`);
    if (target.dataset.color) paint(roomId, { corParede: target.dataset.color }, `Pintar paredes: ${roomName()}`);
  });
  // "change" só dispara ao fechar o seletor de cor: um único passo no histórico.
  picker.addEventListener('change', () => {
    if (roomId) paint(roomId, { corParede: picker.value }, `Pintar paredes: ${roomName()}`);
  });

  const render = () => {
    const room = house.comodos.find((r) => r.id === roomId);
    panel.hidden = !room;
    if (!room) return;
    const override = houseState.get(room.id);
    const floor = override.piso ?? room.piso;
    const color = (override.corParede ?? room.corParede).toLowerCase();
    title.textContent = room.nome;
    for (const b of floors.querySelectorAll<HTMLElement>('.swatch')) b.classList.toggle('active', b.dataset.floor === floor);
    for (const b of colors.querySelectorAll<HTMLElement>('.swatch')) b.classList.toggle('active', b.dataset.color === color);
    picker.value = color;
  };

  editor.on('room', (id) => {
    roomId = id;
    render();
  });
  houseState.on('changed', render);
  return panel;
}
