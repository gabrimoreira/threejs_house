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
import { createCatalogPanel } from './ui/catalogPanel';
import { createPlacementBar } from './ui/placementBar';

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

  const editor = new Editor(ctx, world, house);
  const thumbnails = new ThumbnailService(ctx.renderer, ctx.scene.environment);
  const catalogPanel = createCatalogPanel({
    root: ui,
    thumbnails,
    onPick: (item, variant) => void editor.startPlacement(item, variant),
  });
  createPlacementBar(ui, editor);

  // Centraliza a imagem na área que o catálogo não cobre: à direita dele no
  // desktop, acima dele no celular (onde vira uma gaveta embaixo).
  const updateInsets = () => {
    const rect = catalogPanel.getBoundingClientRect();
    const bottomSheet = rect.left < 4 && rect.bottom >= window.innerHeight - 4;
    ctx.setViewInsets(bottomSheet ? 0 : rect.right, bottomSheet ? window.innerHeight - rect.top : 0);
  };
  new ResizeObserver(updateInsets).observe(catalogPanel);
  window.addEventListener('resize', updateInsets);
  updateInsets();
  ctx.frameHouse();
  loading.hidden = true;

  // Em desenvolvimento, expõe o contexto no console para inspecionar a cena.
  if (import.meta.env.DEV) {
    Object.assign(window, { casa: { ctx, house, built, world, view, editor } });
  }
}

main().catch((err) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = 'Erro ao carregar a cena. Veja o console.';
});
