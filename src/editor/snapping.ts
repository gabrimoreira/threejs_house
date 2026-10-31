import type { Room } from '../house/types';
import { findRoomAt } from '../house/roomLookup';

/** Passo do grid em metros. */
export const GRID_STEP = 0.25;

export const roundMm = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Largura e profundidade do retângulo alinhado aos eixos (AABB) que envolve
 * um footprint w × d girado de `degrees`.
 */
export function rotatedExtents(w: number, d: number, degrees: number): [number, number] {
  const r = (degrees * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return [w * c + d * s, w * s + d * c];
}

/**
 * Encaixa no grid a borda do footprint (não o centro): assim um móvel de 0,9 m
 * fica rente a uma linha do grid em vez de "sobrar" 0,05 m de cada lado.
 */
export function snapToGrid(x: number, z: number, w: number, d: number, degrees: number): [number, number] {
  const [ew, ed] = rotatedExtents(w, d, degrees);
  const sx = Math.round((x - ew / 2) / GRID_STEP) * GRID_STEP + ew / 2;
  const sz = Math.round((z - ed / 2) / GRID_STEP) * GRID_STEP + ed / 2;
  // Arredonda ao milímetro: evita lixo de ponto flutuante (5.4100000260000005) no save.
  return [roundMm(sx), roundMm(sz)];
}

/** Os 4 cantos do footprint (já girado) caem dentro de algum cômodo? */
export function footprintInsideHouse(rooms: Room[], x: number, z: number, w: number, d: number, degrees: number): boolean {
  const [ew, ed] = rotatedExtents(w, d, degrees);
  const eps = 1e-6;
  return [
    [x - ew / 2 + eps, z - ed / 2 + eps],
    [x + ew / 2 - eps, z - ed / 2 + eps],
    [x - ew / 2 + eps, z + ed / 2 - eps],
    [x + ew / 2 - eps, z + ed / 2 - eps],
  ].every(([cx, cz]) => findRoomAt(rooms, cx, cz) !== undefined);
}
