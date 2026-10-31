# Casa Sandbox

Jogo de decoração 3D no navegador, feito com [three.js](https://threejs.org) para aprender a biblioteca. A casa (sala, cozinha, quarto e banheiro) é gerada a partir de um JSON. Você adiciona, move, gira e troca móveis de um catálogo low-poly, pinta paredes, troca pisos e passeia em 1ª pessoa. Tudo é salvo automaticamente no navegador.

100% client-side: sem backend e sem chamadas de rede além dos próprios arquivos do jogo.

## Como rodar

Requer Node 20.19+ ou 22.12+.

```bash
npm install
npm run dev       # servidor de desenvolvimento em http://localhost:5173
npm run build     # checagem de tipos (tsc) + build de produção em dist/
npm run preview   # serve o dist/ para testar o build
```

Para testar no celular, rode `npm run dev -- --host` e abra o endereço de rede que o Vite mostrar.

Em desenvolvimento, o objeto `casa` fica disponível no console do navegador (`casa.world`, `casa.ctx.scene`, `casa.editor`...) para inspecionar o jogo.

## Controles

| Ação | Desktop | Celular |
| --- | --- | --- |
| Girar / zoom / mover a câmera | arrastar / roda / botão direito | um dedo / pinça / dois dedos |
| Colocar um móvel | clicar numa variante do catálogo e clicar no piso (Shift+clique coloca vários) | tocar na variante, tocar no piso, "Colocar" |
| Selecionar | clicar no móvel | tocar no móvel |
| Mover | arrastar o móvel selecionado | arrastar o móvel selecionado |
| Girar 90° / livre | R / Shift+R (mova o mouse, clique confirma) | botões e slider do inspetor |
| Duplicar / excluir | Ctrl+D / Delete | botões do inspetor |
| Desfazer / refazer | Ctrl+Z / Ctrl+Y (ou Ctrl+Shift+Z) | ↶ ↷ |
| Trocar piso e pintura | clicar no piso vazio de um cômodo | tocar no piso vazio |
| Paredes cortadas / transparentes / inteiras | V ou botão "Paredes" | botão "Paredes" |
| Passeio em 1ª pessoa | F ou botão; WASD/setas, Shift corre, Esc sai | (indisponível) |
| Salvar agora / minhas casas | Ctrl+S / ☰ | ☰ |
| Cancelar / desmarcar | Esc | ✕ nos painéis |

## Estrutura de pastas

```
public/assets/models/<categoria>/*.glb   modelos da Kenney (CC0), ver CREDITS.md
src/
  main.ts            liga tudo: cena, casa, estado, editor, interface
  scene/             renderer, câmera + OrbitControls, luzes e sombras, RoomEnvironment,
                     loop de render sob demanda, modo 1ª pessoa (PointerLockControls)
  house/             house.json (a planta), geração de pisos/paredes/janelas/portas,
                     materiais procedurais (canvas), pintura por cômodo, paredes cortadas
  catalog/           catalog.json, cache de GLTF, variantes (recoloridas) com contagem
                     de referências, quadros procedurais, miniaturas renderizadas fora da tela
  editor/            máquina de estados do editor, raycasting, fantasma, destaque, snap
    commands/        padrão Command (AddItems, RemoveItems, UpdateItems, PaintRoom) e o histórico
    rules/           colisão AABB, ímã nas paredes, itens de parede e de bancada
  state/             estado do mundo (fonte da verdade), sincronização com a cena,
                     formato do save, migrações, IndexedDB, autosave, preferências
  ui/                painéis em HTML/CSS puro: catálogo, inspetor, cômodo, saves, barra
  utils/             AABB, emissor de eventos, debounce, dispose
```

A ideia central: o **estado** (`state/world.ts`) é a fonte da verdade e a cena só o reflete (`state/worldView.ts`). O editor nunca mexe no estado direto. Ele cria **comandos** (`editor/commands/`), e o histórico os executa, o que dá desfazer/refazer de graça e um save que é só serializar o estado.

## Como adicionar um móvel ao catálogo

1. **Coloque o modelo** em `public/assets/models/<categoria>/` em formato `.glb`, de preferência do mesmo estilo low-poly (Kenney, Quaternius) e com licença livre. Registre a origem e a licença em `CREDITS.md`.

2. **Adicione uma entrada** em `src/catalog/catalog.json`, na lista `itens`:

   ```json
   {
     "id": "poltronaNova",
     "nome": "Poltrona nova",
     "categoria": "sala",
     "montagem": "piso",
     "arquivo": "models/sala/minhaPoltrona.glb",
     "licenca": "CC0",
     "fonte": "kenney-furniture-kit",
     "variantes": [
       { "id": "padrao", "nome": "Padrão" },
       { "id": "azul", "nome": "Azul", "gerada": true, "materiais": { "carpet": "#4f6d9a" } },
       { "id": "larga", "nome": "Larga", "arquivo": "models/sala/minhaPoltronaLarga.glb" }
     ]
   }
   ```

   | Campo | Para que serve |
   | --- | --- |
   | `id`, `nome`, `categoria` | identificação; `categoria` é um dos `id` em `categorias` |
   | `arquivo` | GLB relativo a `public/assets/`; uma variante pode trocar o arquivo |
   | `montagem` | `piso`, `parede` (gruda na parede, usa `alturaParede` = altura da base em m) ou `bancada` (pode ficar em cima de móveis com `superficie`) |
   | `escala` | escala do modelo; sem ela vale `escalaPadrao` (2.0, porque os modelos da Kenney usam cerca de 0,5 m por unidade) |
   | `rotacaoBase` | graus para a frente do modelo apontar para +Z (os da Kenney já apontam) |
   | `superficie` | `{}` = aceita itens de bancada em cima, na altura do topo do modelo; `{ "altura": 0.9 }` para fixar a altura do tampo |
   | `colisao` | `false` para itens que não esbarram em nada (tapetes) |
   | `footprint` | `[largura, profundidade]` em m; sem ele, vem da bounding box do modelo |
   | `variantes` | outro modelo (`arquivo`) e/ou outra cor (`gerada: true` + `materiais`: nome do material → cor) |

3. **Para descobrir os nomes dos materiais** de um GLB (para as variantes de cor), rode no console do navegador com o `npm run dev` aberto:

   ```js
   const { loadTemplate } = await import('/src/catalog/modelCache.ts');
   const t = await loadTemplate('models/sala/minhaPoltrona.glb');
   const nomes = new Set(); t.traverse((o) => o.isMesh && nomes.add(o.material.name)); nomes;
   ```

4. **Confira no jogo**: compare o tamanho com a porta (2,1 m) e com móveis conhecidos e ajuste `escala`. Se a frente estiver virada, ajuste `rotacaoBase`. As miniaturas são geradas na primeira vez e guardadas no IndexedDB. Se você mudar um item que já existia, aumente o `version` do catálogo para regerá-las.

## Como editar a planta

`src/house/house.json` descreve a casa em metros (X para a direita, Z para "baixo" na planta):

- `comodos`: retângulos `{ x, z, largura, profundidade }` com piso e cor de parede iniciais;
- `paredes`: segmentos `de` → `ate` (linha central), com `aberturas` de `porta`, `janela` (com `peitoril`) ou `vao`, posicionadas por `offset` (distância a partir de `de`);
- `pisos`: estilos de piso desenhados em canvas (`tabuas`, `azulejo`, `carpete`, `liso`).

Os cômodos devem ser retângulos alinhados aos eixos, e as paredes, horizontais ou verticais. Com o `npm run dev` aberto, a casa é refeita ao salvar o arquivo.

## Saves

Os saves ficam no IndexedDB do navegador (banco `casa-sandbox-saves`). O formato, que também é o do JSON exportado:

```json
{
  "version": 1,
  "id": "k3x9…",
  "nome": "Minha casa",
  "atualizadoEm": "2026-10-30T21:00:00.000Z",
  "casa": { "comodos": { "sala": { "piso": "carpete", "corParede": "#f3d9d3" } } },
  "itens": [
    { "uid": "a1b2…", "catalogId": "microondas", "variante": "preto",
      "posicao": [7.45, 0.9, 0.5], "rotacao": 0, "comodo": "cozinha",
      "apoio": "uid-do-balcao", "parede": null }
  ]
}
```

Para mudar o formato: aumente `SAVE_VERSION` em `src/state/migrations.ts` e escreva a função que converte a versão anterior na nova. Ao abrir ou importar, os saves antigos passam por todas as migrações em sequência.

## Desempenho

- `setPixelRatio(min(devicePixelRatio, 2))`, uma única luz com sombra (mapa de 1024 px em telas de toque) e mapa de sombra recalculado só quando a cena muda.
- A cena só é redesenhada quando algo muda.
- Cada parede é uma única malha com cores por vértice: a casa vazia leva cerca de 30 draw calls por frame (47 nos frames em que a sombra é recalculada).
- Os GLBs são carregados uma vez e clonados. Os recursos de cada variante (materiais recoloridos, quadros) são liberados da GPU quando o último item que os usa sai da cena.

## Limitações conhecidas

- O catálogo não tem itens de teto, e itens de bancada não sobem em armários aéreos.
- Na rotação livre (ângulos que não são múltiplos de 90°), a colisão usa a caixa alinhada aos eixos do móvel girado, um pouco maior que ele.
- Posições editadas à mão num JSON importado não passam pelas regras de colisão.
- A 1ª pessoa precisa de mouse (Pointer Lock) e só colide com paredes, não com móveis.

## Créditos

Modelos 3D: [Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit) (CC0). Detalhes e lista de arquivos em [CREDITS.md](CREDITS.md).
