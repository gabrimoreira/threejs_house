import './style.css';
import houseJson from './house/house.json';
import type { HouseData } from './house/types';
import { computeHouseBounds } from './house/roomLookup';
import { buildHouse } from './house/buildHouse';
import { createSceneContext } from './scene/sceneContext';
import { ThumbnailService } from './catalog/thumbnails';
import { World } from './state/world';
import { WorldView } from './state/worldView';
import { Editor } from './editor/editor';
import { History } from './editor/commands/History';
import { createCatalogPanel, isNarrowScreen } from './ui/catalogPanel';
import { createPlacementBar } from './ui/placementBar';
import { createInspector } from './ui/inspector';
import { createToolbar } from './ui/toolbar';
import { Toast } from './ui/toast';

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

  const history = new History();
  const editor = new Editor(ctx, world, view, history, house, [...built.walls.values()]);
  const thumbnails = new ThumbnailService(ctx.renderer, ctx.scene.environment);

  const catalog = createCatalogPanel({
    root: document.getElementById('sidebar')!,
    thumbnails,
    onPick: (item, variant) => void editor.startPlacement(item, variant),
  });
  createPlacementBar(ui, editor);
  const inspector = createInspector({ root: ui, editor, world, thumbnails, rooms: house.comodos });
  createToolbar(document.getElementById('toolbar')!, editor, history);

  const toast = new Toast(ui);
  editor.on('message', (text) => toast.show(text));
  editor.on('hint', (text) => toast.hint(text));
  // No celular o inspetor ocupa a parte de baixo: recolhe o catálogo ao selecionar.
  editor.on('selection', (uid) => {
    if (uid && isNarrowScreen()) catalog.setCollapsed(true);
  });

  // Centraliza a imagem na área que os painéis não cobrem: à direita do catálogo no
  // desktop; no celular, acima do que estiver embaixo (gaveta do catálogo ou inspetor).
  const updateInsets = () => {
    const rect = catalog.element.getBoundingClientRect();
    if (!isNarrowScreen()) {
      ctx.setViewInsets(rect.right, 0);
      return;
    }
    let top = rect.top;
    if (!inspector.hidden) top = Math.min(top, inspector.getBoundingClientRect().top);
    ctx.setViewInsets(0, window.innerHeight - top);
  };
  const insetsObserver = new ResizeObserver(updateInsets);
  insetsObserver.observe(catalog.element);
  insetsObserver.observe(inspector);
  window.addEventListener('resize', updateInsets);
  updateInsets();
  ctx.frameHouse();
  loading.hidden = true;

  // Em desenvolvimento, expõe o contexto no console para inspecionar a cena.
  if (import.meta.env.DEV) {
    Object.assign(window, { casa: { ctx, house, built, world, view, editor, history } });
  }
}

main().catch((err) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = 'Erro ao carregar a cena. Veja o console.';
});
