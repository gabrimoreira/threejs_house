# Créditos e licenças

Todos os assets de terceiros usados no projeto têm licença que permite uso livre.

## Modelos 3D

| Pacote | Autor | Origem | Licença | Onde está |
| --- | --- | --- | --- | --- |
| Furniture Kit (v2.0 segundo o `License.txt` do pacote) | Kenney (www.kenney.nl) | https://kenney.nl/assets/furniture-kit | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | `public/assets/models/` (cópia da licença em `public/assets/models/LICENSE-kenney-furniture-kit.txt`) |

Arquivos usados (formato GLB, sem modificação):

- `models/casa/doorwayFront.glb`: porta de entrada
- `models/casa/doorwayOpen.glb`: portas internas

## Gerados em código (autoria própria)

- Pisos (tábuas, azulejo, carpete, liso): texturas desenhadas em `<canvas>` em `src/house/materials.ts`.
- Paredes e janelas: geometria gerada a partir de `src/house/house.json` em `src/house/buildHouse.ts`.

## Código de terceiros

- [three.js](https://threejs.org) e seus addons (OrbitControls, GLTFLoader, RoomEnvironment, BufferGeometryUtils): licença MIT.
- [idb-keyval](https://github.com/jakearchibald/idb-keyval): licença Apache-2.0.
