import * as THREE from 'three';
import { createStore, get, set, type UseStore } from 'idb-keyval';
import type { CatalogItem, CatalogVariant } from './types';
import { catalog } from './catalog';
import { acquireVariant, releaseVariant } from './variants';

const SIZE = 128; // px renderizados (exibidos a 64 px CSS, nítidos em telas retina)
const THUMB_VERSION = 3; // aumente ao mudar o enquadramento/iluminação para invalidar o cache
const BACKGROUND = '#e9eef1';

/** Tabela linear → sRGB para os 256 valores possíveis de um canal de 8 bits. */
const LINEAR_TO_SRGB = new Uint8ClampedArray(256);
for (let i = 0; i < 256; i++) {
  const l = i / 255;
  const s = l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  LINEAR_TO_SRGB[i] = Math.round(s * 255);
}

/**
 * Miniaturas do catálogo, renderizadas uma vez e guardadas no IndexedDB.
 *
 * Usamos o MESMO WebGLRenderer da cena (navegadores limitam o número de contextos
 * WebGL), desenhando numa WebGLRenderTarget: uma "tela invisível" na GPU.
 */
export class ThumbnailService {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly target = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4 });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  private readonly pixels = new Uint8Array(SIZE * SIZE * 4);
  private readonly urls = new Map<string, Promise<string>>();
  private store: UseStore | null = null;
  // Fila: uma miniatura por vez, com um frame de folga entre elas para não travar a UI.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(renderer: THREE.WebGLRenderer, environment: THREE.Texture | null) {
    this.renderer = renderer;
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.5;
    // Luzes próprias, sem sombra (a cena de miniatura não precisa de shadow map).
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    try {
      this.store = createStore('casa-sandbox-thumbs', 'thumbs');
    } catch {
      this.store = null; // sem IndexedDB (ex.: modo privado em alguns navegadores): só cache em memória
    }
  }

  /** URL (blob:) da miniatura da variante. */
  get(item: CatalogItem, variant: CatalogVariant): Promise<string> {
    const key = `v${catalog.version}.${THUMB_VERSION}:${item.id}:${variant.id}`;
    let url = this.urls.get(key);
    if (!url) {
      url = this.load(key, item, variant).then((blob) => URL.createObjectURL(blob));
      url.catch(() => this.urls.delete(key));
      this.urls.set(key, url);
    }
    return url;
  }

  private async load(key: string, item: CatalogItem, variant: CatalogVariant): Promise<Blob> {
    if (this.store) {
      const cached = await get<Blob>(key, this.store).catch(() => undefined);
      if (cached) return cached;
    }
    const job = this.queue.then(async () => {
      await new Promise(requestAnimationFrame);
      return this.render(item, variant);
    });
    this.queue = job.catch(() => {});
    const blob = await job;
    if (this.store) await set(key, blob, this.store).catch(() => {});
    return blob;
  }

  private async render(item: CatalogItem, variant: CatalogVariant): Promise<Blob> {
    const info = await acquireVariant(item, variant);
    try {
      const object = info.template;
      this.scene.add(object);

      // Enquadra a esfera que envolve o modelo, vista de frente-direita-cima.
      const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
      const fov = THREE.MathUtils.degToRad(this.camera.fov);
      const distance = sphere.radius / Math.sin(fov / 2);
      const dir = new THREE.Vector3(0.75, 0.65, 1.2).normalize();
      this.camera.position.copy(sphere.center).addScaledVector(dir, distance);
      this.camera.near = distance / 100;
      this.camera.far = distance * 4;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(sphere.center);

      // Desenha na render target em vez do canvas, e devolve o estado do renderer depois.
      const r = this.renderer;
      const previousTarget = r.getRenderTarget();
      const previousClear = r.getClearColor(new THREE.Color());
      const previousAlpha = r.getClearAlpha();
      r.setRenderTarget(this.target);
      r.setClearColor(BACKGROUND, 1);
      r.clear();
      r.render(this.scene, this.camera);
      r.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this.pixels);
      r.setRenderTarget(previousTarget);
      r.setClearColor(previousClear, previousAlpha);

      this.scene.remove(object);
      return await this.toBlob();
    } finally {
      releaseVariant(info.key);
    }
  }

  /**
   * Converte os pixels lidos da GPU numa imagem PNG.
   * Numa render target o three grava cores LINEARES (sem a conversão para sRGB que
   * faz ao desenhar na tela), então convertemos aqui. A GPU também guarda as linhas
   * de baixo para cima, por isso invertemos o eixo Y.
   */
  private toBlob(): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const src = ((SIZE - 1 - y) * SIZE + x) * 4;
        const dst = (y * SIZE + x) * 4;
        image.data[dst] = LINEAR_TO_SRGB[this.pixels[src]];
        image.data[dst + 1] = LINEAR_TO_SRGB[this.pixels[src + 1]];
        image.data[dst + 2] = LINEAR_TO_SRGB[this.pixels[src + 2]];
        image.data[dst + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob falhou'))), 'image/png'),
    );
  }
}
