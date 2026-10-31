# Créditos e licenças

Todos os assets de terceiros usados no projeto têm licença que permite uso livre.

## Modelos 3D

| Pacote | Autor | Origem | Licença | Onde está |
| --- | --- | --- | --- | --- |
| Furniture Kit (v2.0 segundo o `License.txt` do pacote) | Kenney (www.kenney.nl) | https://kenney.nl/assets/furniture-kit | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | `public/assets/models/` (cópia da licença em `public/assets/models/LICENSE-kenney-furniture-kit.txt`) |

Arquivos usados (formato GLB, sem modificação; recolorações das variantes "geradas" são feitas em código, em tempo de execução):

- `models/banheiro/` (13): `bathroomCabinet.glb`, `bathroomCabinetDrawer.glb`, `bathroomMirror.glb`, `bathroomSink.glb`, `bathroomSinkSquare.glb`, `bathtub.glb`, `dryer.glb`, `shower.glb`, `showerRound.glb`, `toilet.glb`, `toiletSquare.glb`, `washer.glb`, `washerDryerStacked.glb`
- `models/casa/` (2): `doorwayFront.glb`, `doorwayOpen.glb`
- `models/cozinha/` (25): `hoodLarge.glb`, `hoodModern.glb`, `kitchenBar.glb`, `kitchenBarEnd.glb`, `kitchenBlender.glb`, `kitchenCabinet.glb`, `kitchenCabinetCornerInner.glb`, `kitchenCabinetCornerRound.glb`, `kitchenCabinetDrawer.glb`, `kitchenCabinetUpper.glb`, `kitchenCabinetUpperCorner.glb`, `kitchenCabinetUpperDouble.glb`, `kitchenCabinetUpperLow.glb`, `kitchenCoffeeMachine.glb`, `kitchenFridge.glb`, `kitchenFridgeBuiltIn.glb`, `kitchenFridgeLarge.glb`, `kitchenFridgeSmall.glb`, `kitchenMicrowave.glb`, `kitchenSink.glb`, `kitchenStove.glb`, `kitchenStoveElectric.glb`, `stoolBar.glb`, `stoolBarSquare.glb`, `toaster.glb`
- `models/decoracao/` (15): `bear.glb`, `books.glb`, `cardboardBoxClosed.glb`, `cardboardBoxOpen.glb`, `coatRack.glb`, `coatRackStanding.glb`, `pillow.glb`, `pillowBlue.glb`, `pillowBlueLong.glb`, `pillowLong.glb`, `plantSmall1.glb`, `plantSmall2.glb`, `plantSmall3.glb`, `pottedPlant.glb`, `trashcan.glb`
- `models/eletronicos/` (7): `computerScreen.glb`, `laptop.glb`, `radio.glb`, `speaker.glb`, `speakerSmall.glb`, `televisionModern.glb`, `televisionVintage.glb`
- `models/iluminacao/` (5): `lampRoundFloor.glb`, `lampRoundTable.glb`, `lampSquareFloor.glb`, `lampSquareTable.glb`, `lampWall.glb`
- `models/mesas/` (16): `bench.glb`, `benchCushion.glb`, `benchCushionLow.glb`, `chair.glb`, `chairCushion.glb`, `chairModernCushion.glb`, `chairModernFrameCushion.glb`, `chairRounded.glb`, `sideTable.glb`, `sideTableDrawers.glb`, `table.glb`, `tableCloth.glb`, `tableCross.glb`, `tableCrossCloth.glb`, `tableGlass.glb`, `tableRound.glb`
- `models/quarto/` (9): `bedBunk.glb`, `bedDouble.glb`, `bedSingle.glb`, `cabinetBed.glb`, `cabinetBedDrawer.glb`, `cabinetBedDrawerTable.glb`, `chairDesk.glb`, `desk.glb`, `deskCorner.glb`
- `models/sala/` (25): `bookcaseClosed.glb`, `bookcaseClosedDoors.glb`, `bookcaseClosedWide.glb`, `bookcaseOpen.glb`, `bookcaseOpenLow.glb`, `cabinetTelevision.glb`, `cabinetTelevisionDoors.glb`, `loungeChair.glb`, `loungeChairRelax.glb`, `loungeDesignChair.glb`, `loungeDesignSofa.glb`, `loungeDesignSofaCorner.glb`, `loungeSofa.glb`, `loungeSofaCorner.glb`, `loungeSofaLong.glb`, `loungeSofaOttoman.glb`, `rugDoormat.glb`, `rugRectangle.glb`, `rugRound.glb`, `rugRounded.glb`, `rugSquare.glb`, `tableCoffee.glb`, `tableCoffeeGlass.glb`, `tableCoffeeGlassSquare.glb`, `tableCoffeeSquare.glb`

## Gerados em código (autoria própria)

- Pisos (tábuas, azulejo, carpete, liso): texturas desenhadas em `<canvas>` em `src/house/materials.ts`.
- Paredes e janelas: geometria gerada a partir de `src/house/house.json` em `src/house/buildHouse.ts`.
- Quadros (item "Quadro" do catálogo): moldura e arte desenhadas em código em `src/catalog/procedural.ts`.

## Código de terceiros

- [three.js](https://threejs.org) e seus addons (OrbitControls, GLTFLoader, RoomEnvironment, BufferGeometryUtils): licença MIT.
- [idb-keyval](https://github.com/jakearchibald/idb-keyval): licença Apache-2.0.
