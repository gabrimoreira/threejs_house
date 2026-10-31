import * as THREE from 'three';

/**
 * Raycasting: transforma um ponto da tela num raio 3D que sai da câmera,
 * para descobrir o que está "debaixo" do cursor.
 */
export class Picker {
  readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly camera: THREE.Camera;
  private readonly dom: HTMLElement;

  constructor(camera: THREE.Camera, dom: HTMLElement) {
    this.camera = camera;
    this.dom = dom;
  }

  /** Aponta o raio para a posição do ponteiro. */
  setFromEvent(event: { clientX: number; clientY: number }): void {
    const rect = this.dom.getBoundingClientRect();
    // NDC (normalized device coordinates): de -1 a 1 nos dois eixos, com Y para cima.
    this.ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  /**
   * Ponto onde o raio cruza o plano horizontal y = height. Usar um plano matemático
   * é mais barato e mais estável do que testar contra as malhas do piso.
   */
  floorPoint(height = 0, target = new THREE.Vector3()): THREE.Vector3 | null {
    this.plane.constant = -height;
    return this.raycaster.ray.intersectPlane(this.plane, target);
  }
}
