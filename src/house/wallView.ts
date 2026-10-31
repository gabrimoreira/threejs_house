import * as THREE from 'three';
import type { SceneContext } from '../scene/sceneContext';
import type { BuiltHouse, WallParts } from './buildHouse';
import { Emitter } from '../utils/emitter';

export type WallViewMode = 'inteiras' | 'cortadas' | 'transparentes';

/** Altura (m) que sobra de uma parede cortada: dá para ver dentro e ainda entender a planta. */
const CUT_HEIGHT = 0.35;

/**
 * Esconde as paredes que ficam entre a câmera e o ponto que ela olha, para ver
 * dentro dos cômodos. Uma parede "atrapalha" quando a câmera e o alvo (target do
 * OrbitControls) estão em lados opostos da linha dela, olhando a planta de cima.
 *
 * - cortadas: a alvenaria é achatada (escala em Y) e janelas/portas somem;
 * - transparentes: a alvenaria troca para um material translúcido.
 */
export class WallView extends Emitter<{ mode: WallViewMode }> {
  private readonly ctx: SceneContext;
  private readonly built: BuiltHouse;
  private readonly wallHeight: number;
  private mode: WallViewMode = 'cortadas';
  private enabled = true;
  /** Paredes atualmente cortadas/transparentes, para só mexer no que mudou. */
  private affected = new Set<string>();

  constructor(ctx: SceneContext, built: BuiltHouse, wallHeight: number) {
    super();
    this.ctx = ctx;
    this.built = built;
    this.wallHeight = wallHeight;
    ctx.controls.addEventListener('change', () => this.update());
  }

  get current(): WallViewMode {
    return this.mode;
  }

  setMode(mode: WallViewMode): void {
    this.mode = mode;
    this.refresh();
    this.emit('mode', mode);
  }

  /** Desliga o efeito (ex.: em 1ª pessoa, todas as paredes ficam inteiras). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.refresh();
  }

  /** Reaplica do zero (mudou o modo ou o liga/desliga). */
  private refresh(): void {
    for (const id of this.affected) this.restore(this.built.wallParts.get(id)!);
    this.affected.clear();
    this.update();
  }

  /** Recalcula quais paredes atrapalham a vista. Chamado a cada movimento da câmera. */
  update(): void {
    const next = new Set<string>();
    if (this.enabled && this.mode !== 'inteiras') {
      const cam = this.ctx.camera.position;
      const target = this.ctx.controls.target;
      for (const [id, parts] of this.built.wallParts) {
        if (blocksView(parts, cam, target)) next.add(id);
      }
    }
    let changed = false;
    for (const id of this.affected) {
      if (!next.has(id)) {
        this.restore(this.built.wallParts.get(id)!);
        changed = true;
      }
    }
    for (const id of next) {
      if (!this.affected.has(id)) {
        this.apply(this.built.wallParts.get(id)!);
        changed = true;
      }
    }
    this.affected = next;
    // Paredes cortadas fazem sombras menores: o mapa de sombra precisa ser refeito.
    if (changed) this.ctx.invalidateShadows();
  }

  private apply(parts: WallParts): void {
    if (this.mode === 'cortadas') {
      parts.masonry.scale.y = CUT_HEIGHT / this.wallHeight;
    } else {
      parts.masonry.material = this.built.materials.wallsFaded;
      // Para o raycasting: dá para clicar nos móveis através desta parede.
      parts.masonry.userData.seeThrough = true;
    }
    for (const obj of [parts.frames, parts.glass, ...parts.doors]) if (obj) obj.visible = false;
  }

  private restore(parts: WallParts): void {
    parts.masonry.scale.y = 1;
    parts.masonry.material = this.built.materials.walls;
    parts.masonry.userData.seeThrough = false;
    for (const obj of [parts.frames, parts.glass, ...parts.doors]) if (obj) obj.visible = true;
  }
}

/**
 * O segmento câmera→alvo, visto de cima (plano XZ), cruza o segmento da parede?
 * 1) câmera e alvo precisam estar em lados opostos da linha da parede (sinal do produto vetorial);
 * 2) o ponto onde a linha de visão cruza essa linha precisa cair dentro da parede.
 */
function blocksView(parts: WallParts, cam: THREE.Vector3, target: THREE.Vector3): boolean {
  const [x0, z0] = parts.wall.de;
  const [x1, z1] = parts.wall.ate;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const side = (x: number, z: number) => dx * (z - z0) - dz * (x - x0);
  const sc = side(cam.x, cam.z);
  const st = side(target.x, target.z);
  if (sc * st >= 0) return false;
  // Posição (0 = "de", 1 = "ate") ao longo da parede de cada ponta da linha de visão,
  // interpolada até o ponto de cruzamento.
  const len2 = dx * dx + dz * dz;
  const along = (x: number, z: number) => ((x - x0) * dx + (z - z0) * dz) / len2;
  const tCam = along(cam.x, cam.z);
  const tTarget = along(target.x, target.z);
  const t = tCam + (tTarget - tCam) * (sc / (sc - st));
  const margin = 0.05;
  return t >= -margin && t <= 1 + margin;
}
