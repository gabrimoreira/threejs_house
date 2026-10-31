import * as THREE from 'three';
import type { PaintingParams } from './types';

/** Recursos de GPU criados por um gerador, para o dono poder liberá-los depois. */
export interface OwnedResources {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
}

/** Desenha a arte do quadro num canvas 2D, conforme o estilo pedido. */
function drawArt(ctx: CanvasRenderingContext2D, w: number, h: number, p: PaintingParams): void {
  const [bg, a, b, c] = p.cores;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  switch (p.arte) {
    case 'circulos': {
      const circles: [number, number, number, string][] = [
        [0.35, 0.35, 0.28, a],
        [0.65, 0.6, 0.22, b],
        [0.4, 0.75, 0.12, c],
      ];
      for (const [cx, cy, r, color] of circles) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx * w, cy * h, r * Math.min(w, h), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'listras': {
      const colors = [a, b, c];
      const band = w / 6;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 4);
      for (let i = -8; i < 8; i++) {
        ctx.fillStyle = colors[(i + 24) % 3];
        ctx.fillRect(i * band, -w * 1.5, band * 0.6, w * 3);
      }
      ctx.restore();
      break;
    }
    case 'paisagem': {
      // céu (bg), sol (c), morro de trás (a), morro da frente (b)
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(w * 0.72, h * 0.3, h * 0.12, 0, Math.PI * 2);
      ctx.fill();
      const hill = (color: string, base: number, amp: number, phase: number) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 4) ctx.lineTo(x, h * base - Math.sin(x / w * Math.PI * 2 + phase) * h * amp);
        ctx.lineTo(w, h);
        ctx.fill();
      };
      hill(a, 0.62, 0.1, 0.5);
      hill(b, 0.78, 0.08, 2.2);
      break;
    }
    case 'blocos': {
      // composição de retângulos com linhas pretas, no estilo neoplasticista
      const line = Math.max(3, w * 0.025);
      const rects: [number, number, number, number, string][] = [
        [0, 0, 0.6, 0.55, a],
        [0.6, 0.55, 0.4, 0.45, b],
        [0, 0.8, 0.3, 0.2, c],
      ];
      for (const [x, y, rw, rh, color] of rects) {
        ctx.fillStyle = color;
        ctx.fillRect(x * w, y * h, rw * w, rh * h);
      }
      // linhas [x0, y0, x1, y1] em frações da tela
      const lines: [number, number, number, number][] = [
        [0.6, 0, 0.6, 1],
        [0.3, 0.55, 0.3, 1],
        [0, 0.55, 1, 0.55],
        [0, 0.8, 0.6, 0.8],
      ];
      ctx.fillStyle = '#1b1b1b';
      for (const [x0, y0, x1, y1] of lines) {
        ctx.fillRect(x0 * w - line / 2, y0 * h - line / 2, (x1 - x0) * w + line, (y1 - y0) * h + line);
      }
      break;
    }
  }
}

/**
 * Quadro gerado em código: uma caixa fina (moldura) com a arte desenhada num
 * <canvas> aplicada como textura num plano logo à frente. A frente aponta para +Z
 * e o pivô fica no centro da base, igual aos modelos do catálogo.
 */
export function buildPainting(p: PaintingParams, owned: OwnedResources): THREE.Group {
  const depth = 0.035;
  const border = Math.min(p.largura, p.altura) * 0.07;

  const frameGeometry = new THREE.BoxGeometry(p.largura, p.altura, depth);
  const frameMaterial = new THREE.MeshStandardMaterial({ color: p.moldura, roughness: 0.6 });

  const pxPerMeter = 400;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((p.largura - 2 * border) * pxPerMeter);
  canvas.height = Math.round((p.altura - 2 * border) * pxPerMeter);
  drawArt(canvas.getContext('2d')!, canvas.width, canvas.height, p);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const artGeometry = new THREE.PlaneGeometry(p.largura - 2 * border, p.altura - 2 * border);
  const artMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 });

  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  frame.position.y = p.altura / 2;
  const art = new THREE.Mesh(artGeometry, artMaterial);
  // 1 mm à frente da moldura para não brigar com ela no depth buffer.
  art.position.set(0, p.altura / 2, depth / 2 + 0.001);

  for (const mesh of [frame, art]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }

  owned.geometries.push(frameGeometry, artGeometry);
  owned.materials.push(frameMaterial, artMaterial);
  owned.textures.push(texture);

  const group = new THREE.Group();
  group.add(frame, art);
  return group;
}
