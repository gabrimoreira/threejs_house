import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import type { SceneContext } from './sceneContext';
import type { HouseData, WallCollider } from '../house/types';
import { findRoomAt } from '../house/roomLookup';
import { Emitter } from '../utils/emitter';

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 2.2; // m/s
const RUN_SPEED = 4.2;
/** "Raio" do corpo: a câmera fica a pelo menos isto das paredes. */
const BODY_RADIUS = 0.25;

/**
 * Passeio em 1ª pessoa com PointerLockControls: o navegador "prende" o mouse
 * (Pointer Lock API) e cada movimento dele gira a câmera. WASD/setas andam,
 * Shift corre e Esc solta o mouse e volta para a câmera orbital.
 *
 * Colisão só com as paredes (as portas são vãos livres), testando cada eixo
 * separadamente: assim, ao andar na diagonal contra uma parede, o jogador
 * desliza ao longo dela em vez de travar.
 */
export class FirstPersonMode extends Emitter<{ active: boolean; error: string }> {
  private readonly ctx: SceneContext;
  private readonly house: HouseData;
  private readonly walls: WallCollider[];
  private readonly controls: PointerLockControls;
  private readonly keys = new Set<string>();
  private saved: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;

  constructor(ctx: SceneContext, house: HouseData, colliders: WallCollider[]) {
    super();
    this.ctx = ctx;
    this.house = house;
    // Só alvenaria na altura do corpo bloqueia (vergas acima das portas não).
    this.walls = colliders.filter((c) => c.kind === 'parede' && c.minY < EYE_HEIGHT && c.maxY > 0.3);
    this.controls = new PointerLockControls(ctx.camera, ctx.renderer.domElement);
    // Não deixa olhar exatamente para cima/baixo (a câmera "viraria").
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI - 0.15;

    this.controls.addEventListener('lock', this.onLock);
    this.controls.addEventListener('unlock', this.onUnlock);
    this.controls.addEventListener('change', () => ctx.requestRender());
    document.addEventListener('pointerlockerror', () => {
      this.restoreOrbit();
      this.emit('error', 'O navegador não deixou capturar o mouse. Clique na cena e tente de novo.');
    });
    window.addEventListener('keydown', (e) => this.isActive && this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    ctx.onFrame((dt) => this.update(dt));
  }

  get isActive(): boolean {
    return this.saved !== null;
  }

  /** Entra no modo. Precisa ser chamado a partir de um clique/tecla (exigência do Pointer Lock). */
  enter(): void {
    if (this.isActive) return;
    const { camera, controls } = this.ctx;
    this.saved = { position: camera.position.clone(), target: controls.target.clone() };
    controls.enabled = false;

    // Começa no ponto para onde a câmera orbital olhava, se ele estiver dentro da casa.
    const t = controls.target;
    const room = findRoomAt(this.house.comodos, t.x, t.z) ?? this.house.comodos[0];
    const inside = findRoomAt(this.house.comodos, t.x, t.z) !== undefined;
    const start = inside ? new THREE.Vector3(t.x, 0, t.z) : new THREE.Vector3(room.x + room.largura / 2, 0, room.z + room.profundidade / 2);
    this.pushOut(start);
    // Olha na mesma direção horizontal em que a câmera orbital olhava.
    const look = new THREE.Vector3().subVectors(t, camera.position).setY(0);
    if (look.lengthSq() < 1e-6) look.set(0, 0, 1);
    camera.position.set(start.x, EYE_HEIGHT, start.z);
    camera.lookAt(start.x + look.x, EYE_HEIGHT, start.z + look.z);

    this.controls.lock();
    this.emit('active', true);
    this.ctx.requestRender();
  }

  exit(): void {
    if (this.controls.isLocked) this.controls.unlock();
    else this.restoreOrbit();
  }

  private onLock = () => this.ctx.requestRender();

  // Esc solta o ponteiro: o navegador dispara "unlock" e voltamos à câmera orbital.
  private onUnlock = () => this.restoreOrbit();

  private restoreOrbit(): void {
    if (!this.saved) return;
    const { camera, controls } = this.ctx;
    camera.position.copy(this.saved.position);
    controls.target.copy(this.saved.target);
    controls.enabled = true;
    controls.update();
    this.saved = null;
    this.keys.clear();
    this.emit('active', false);
    this.ctx.requestRender();
  }

  private update(dt: number): void {
    if (!this.isActive || !this.controls.isLocked) return;
    const forward = Number(this.pressed('KeyW', 'ArrowUp')) - Number(this.pressed('KeyS', 'ArrowDown'));
    const right = Number(this.pressed('KeyD', 'ArrowRight')) - Number(this.pressed('KeyA', 'ArrowLeft'));
    if (forward === 0 && right === 0) return;

    // Direção para onde a câmera olha, achatada no chão; "direita" é perpendicular a ela.
    const dir = this.ctx.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
    const move = dir.multiplyScalar(forward).add(side.multiplyScalar(right)).normalize().multiplyScalar(speed * dt);

    const pos = this.ctx.camera.position;
    // Um eixo de cada vez: se X bate na parede, ainda dá para andar em Z (desliza).
    if (!this.hitsWall(pos.x + move.x, pos.z)) pos.x += move.x;
    if (!this.hitsWall(pos.x, pos.z + move.z)) pos.z += move.z;
    this.ctx.requestRender();
  }

  private pressed(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** O "corpo" (um quadrado de lado 2×raio) em (x, z) encosta em alguma parede? */
  private hitsWall(x: number, z: number): boolean {
    return this.walls.some(
      (c) => x + BODY_RADIUS > c.minX && x - BODY_RADIUS < c.maxX && z + BODY_RADIUS > c.minZ && z - BODY_RADIUS < c.maxZ,
    );
  }

  /** Se o ponto inicial caiu dentro de uma parede, procura um ponto livre por perto. */
  private pushOut(p: THREE.Vector3): void {
    if (!this.hitsWall(p.x, p.z)) return;
    for (let r = 0.25; r <= 2; r += 0.25) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (!this.hitsWall(x, z)) {
          p.set(x, 0, z);
          return;
        }
      }
    }
  }
}
