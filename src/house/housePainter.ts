import * as THREE from 'three';
import type { SceneContext } from '../scene/sceneContext';
import type { HouseState } from '../state/houseState';
import type { BuiltHouse, PaintRange } from './buildHouse';
import type { HouseData } from './types';

/**
 * Aplica na cena as personalizações do HouseState: piso e cor de parede por cômodo.
 *
 * - Piso: basta trocar o material da malha do cômodo (os materiais ficam em cache).
 * - Parede: as cores estão gravadas nos vértices (vertexColors). Cada parede guarda
 *   em `paintRanges` quais vértices pertencem à face de qual cômodo; reescrevemos só
 *   esses e marcamos o atributo com needsUpdate para o three reenviar à GPU.
 */
export function connectHousePainter(house: HouseData, built: BuiltHouse, state: HouseState, ctx: SceneContext): void {
  const color = new THREE.Color();

  const apply = (roomId: string | null) => {
    const rooms = roomId ? house.comodos.filter((r) => r.id === roomId) : house.comodos;
    const wallColor = new Map<string, string>();
    for (const room of rooms) {
      const override = state.get(room.id);
      const floorId = override.piso && house.pisos[override.piso] ? override.piso : room.piso;
      const floor = built.floors.get(room.id);
      if (floor) floor.material = built.materials.floor(floorId, house.pisos[floorId]);
      wallColor.set(room.id, override.corParede ?? room.corParede);
    }

    for (const mesh of built.walls.values()) {
      const attribute = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      let touched = false;
      for (const range of mesh.userData.paintRanges as PaintRange[]) {
        const hex = range.roomId ? wallColor.get(range.roomId) : undefined;
        if (!hex) continue; // face externa, ou cômodo que não mudou
        color.set(hex); // converte de sRGB para o espaço linear de trabalho
        for (let i = range.start; i < range.start + range.count; i++) attribute.setXYZ(i, color.r, color.g, color.b);
        touched = true;
      }
      if (touched) attribute.needsUpdate = true;
    }
    ctx.requestRender();
  };

  state.on('changed', apply);
}
