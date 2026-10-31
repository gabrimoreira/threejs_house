import './style.css';
import houseJson from './house/house.json';
import type { HouseData } from './house/types';
import { computeHouseBounds } from './house/roomLookup';
import { buildHouse } from './house/buildHouse';
import { createSceneContext } from './scene/sceneContext';

async function main() {
  // O JSON importado tem tipos "largos" (number[] em vez de [number, number]); declaramos o formato.
  const house = houseJson as unknown as HouseData;
  const viewport = document.getElementById('viewport')!;
  const loading = document.getElementById('loading')!;

  const bounds = computeHouseBounds(house.comodos);
  const ctx = createSceneContext(viewport, bounds);

  const built = await buildHouse(house, ctx.renderer.capabilities.getMaxAnisotropy());
  ctx.scene.add(built.group);
  ctx.invalidateShadows();
  loading.hidden = true;

  // Em desenvolvimento, expõe o contexto no console para inspecionar a cena.
  if (import.meta.env.DEV) {
    Object.assign(window, { casa: { ctx, house, built } });
  }
}

main().catch((err) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = 'Erro ao carregar a cena. Veja o console.';
});
