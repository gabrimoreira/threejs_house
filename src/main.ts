import './style.css';
import houseJson from './house/house.json';
import type { HouseData } from './house/types';
import { computeHouseBounds } from './house/roomLookup';
import { buildHouse } from './house/buildHouse';
import { connectHousePainter } from './house/housePainter';
import { WallView, type WallViewMode } from './house/wallView';
import { createSceneContext } from './scene/sceneContext';
import { FirstPersonMode } from './scene/firstPerson';
import { isCoarsePointer } from './scene/renderer';
import { ThumbnailService } from './catalog/thumbnails';
import { World } from './state/world';
import { HouseState, type RoomOverride } from './state/houseState';
import { SaveManager, type SaveStatus } from './state/saveManager';
import { WorldView } from './state/worldView';
import { loadPref, savePref } from './state/prefs';
import { Editor } from './editor/editor';
import { History } from './editor/commands/History';
import { PaintRoom } from './editor/commands/houseCommands';
import { createCatalogPanel, isNarrowScreen } from './ui/catalogPanel';
import { createPlacementBar } from './ui/placementBar';
import { createInspector } from './ui/inspector';
import { createRoomPanel } from './ui/roomPanel';
import { createToolbar, cycleWallMode } from './ui/toolbar';
import { Toast } from './ui/toast';
import { createSavesDialog } from './ui/savesDialog';

/** Tecla digitada num campo de texto ou com um diálogo aberto não deve virar atalho. */
function isTypingOrDialog(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  return Boolean(typing) || document.querySelector('dialog[open]') !== null;
}

async function main() {
  // O JSON importado tem tipos "largos" (number[] em vez de [number, number]); declaramos o formato.
  const house = houseJson as unknown as HouseData;
  const viewport = document.getElementById('viewport')!;
  const ui = document.getElementById('ui')!;
  const loading = document.getElementById('loading')!;

  const bounds = computeHouseBounds(house.comodos);
  const ctx = createSceneContext(viewport, bounds);

  const built = await buildHouse(house, ctx.renderer.capabilities.getMaxAnisotropy());
  ctx.scene.add(built.group);
  ctx.invalidateShadows();

  // Estado do jogo e sua representação na cena.
  const world = new World();
  const view = new WorldView(world, ctx);
  ctx.scene.add(view.group);
  const houseState = new HouseState();
  connectHousePainter(house, built, houseState, ctx);

  const history = new History();
  const editor = new Editor(ctx, world, view, history, house, {
    occluders: [...built.walls.values()],
    colliders: built.colliders,
    floors: built.floors,
  });
  const thumbnails = new ThumbnailService(ctx.renderer, ctx.scene.environment);
  const toast = new Toast(ui);

  // Paredes cortadas/transparentes (o modo escolhido fica salvo nas preferências).
  const wallView = new WallView(ctx, built, house.alturaParede);
  wallView.setMode(loadPref<WallViewMode>('paredes', 'cortadas'));
  wallView.on('mode', (mode) => savePref('paredes', mode));

  // ---------------------------------------------------------------- painéis

  const catalog = createCatalogPanel({
    root: document.getElementById('sidebar')!,
    thumbnails,
    onPick: (item, variant) => void editor.startPlacement(item, variant),
  });
  createPlacementBar(ui, editor);
  const inspector = createInspector({ root: ui, editor, world, thumbnails, rooms: house.comodos });
  const roomPanel = createRoomPanel({
    root: ui,
    editor,
    house,
    houseState,
    floorPreview: (id) => {
      const canvas = built.materials.floor(id, house.pisos[id]).map?.image as HTMLCanvasElement | undefined;
      return canvas ? canvas.toDataURL() : null;
    },
    paint: (roomId: string, patch: RoomOverride, label: string) => history.execute(new PaintRoom(houseState, roomId, patch, label)),
  });

  // ---------------------------------------------------------------- persistência

  const saves = new SaveManager(world, houseState, history, house);
  const savesDialog = createSavesDialog(ui, saves);
  const statusEl = document.getElementById('save-status')!;
  const statusText: Record<SaveStatus, string> = {
    salvo: 'salvo',
    pendente: 'alterações não salvas…',
    salvando: 'salvando…',
    erro: 'erro ao salvar',
  };
  const showStatus = (status: SaveStatus) => {
    statusEl.textContent = `${saves.currentSave.nome} · ${statusText[status]}`;
    statusEl.classList.toggle('error', status === 'erro');
  };
  saves.on('status', showStatus);
  saves.on('current', () => showStatus('salvo'));
  saves.on('message', (text) => toast.show(text, 4000));

  // ---------------------------------------------------------------- 1ª pessoa

  const firstPerson = new FirstPersonMode(ctx, house, built.colliders);
  firstPerson.on('error', (text) => toast.show(text, 4000));
  firstPerson.on('active', (active) => {
    // Em 1ª pessoa: editor desligado, paredes inteiras, interface escondida.
    document.body.classList.toggle('first-person', active);
    editor.setEnabled(!active);
    wallView.setEnabled(!active);
    if (active) ctx.setViewInsets(0, 0);
    else updateInsets();
  });

  createToolbar({
    container: document.getElementById('toolbar')!,
    viewContainer: document.getElementById('view-tools')!,
    editor,
    history,
    wallView,
    firstPersonAvailable: !isCoarsePointer,
    onFirstPerson: () => firstPerson.enter(),
    onOpenSaves: () => savesDialog.open(),
  });

  window.addEventListener('keydown', (event) => {
    if (isTypingOrDialog(event)) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 's') {
      event.preventDefault(); // Ctrl+S no navegador = salvar a página
      void saves.saveNow().then((ok) => toast.show(ok ? 'Casa salva.' : 'Não foi possível salvar.'));
    } else if (!event.ctrlKey && !event.metaKey && !firstPerson.isActive) {
      if (key === 'v') cycleWallMode(wallView);
      if (key === 'f' && !isCoarsePointer) firstPerson.enter();
    }
  });

  editor.on('message', (text) => toast.show(text));
  editor.on('hint', (text) => toast.hint(text));
  // No celular os painéis ocupam a parte de baixo: recolhe o catálogo ao selecionar.
  const collapseOnPhone = (id: string | null) => {
    if (id && isNarrowScreen()) catalog.setCollapsed(true);
  };
  editor.on('selection', collapseOnPhone);
  editor.on('room', collapseOnPhone);

  // Centraliza a imagem na área que os painéis não cobrem: à direita do catálogo no
  // desktop; no celular, acima do que estiver embaixo (gaveta do catálogo ou painel aberto).
  function updateInsets() {
    if (firstPerson.isActive) return;
    const rect = catalog.element.getBoundingClientRect();
    if (!isNarrowScreen()) {
      ctx.setViewInsets(rect.right, 0);
      return;
    }
    let top = rect.top;
    for (const panel of [inspector, roomPanel]) {
      if (!panel.hidden) top = Math.min(top, panel.getBoundingClientRect().top);
    }
    ctx.setViewInsets(0, window.innerHeight - top);
  }
  const insetsObserver = new ResizeObserver(updateInsets);
  for (const el of [catalog.element, inspector, roomPanel]) insetsObserver.observe(el);
  window.addEventListener('resize', updateInsets);
  updateInsets();
  ctx.frameHouse();

  await saves.init();
  loading.hidden = true;

  // Em desenvolvimento, expõe o contexto no console para inspecionar a cena.
  if (import.meta.env.DEV) {
    Object.assign(window, { casa: { ctx, house, built, world, view, editor, history, saves, houseState, wallView, firstPerson } });
  }
}

main().catch((err) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = 'Erro ao carregar a cena. Veja o console.';
});
