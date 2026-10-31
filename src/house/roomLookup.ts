import type { Bounds2D } from '../scene/camera';
import type { Room } from './types';

/** Cômodo que contém o ponto (x, z) da planta, ou undefined se estiver fora da casa. */
export function findRoomAt(rooms: Room[], x: number, z: number): Room | undefined {
  return rooms.find((r) => x >= r.x && x <= r.x + r.largura && z >= r.z && z <= r.z + r.profundidade);
}

/** Retângulo que envolve todos os cômodos. */
export function computeHouseBounds(rooms: Room[]): Bounds2D {
  return {
    minX: Math.min(...rooms.map((r) => r.x)),
    maxX: Math.max(...rooms.map((r) => r.x + r.largura)),
    minZ: Math.min(...rooms.map((r) => r.z)),
    maxZ: Math.max(...rooms.map((r) => r.z + r.profundidade)),
  };
}
