import type { HouseState, RoomOverride } from '../../state/houseState';
import type { Command } from './Command';

/** Troca piso e/ou cor de parede de um cômodo. Desfazer volta aos valores anteriores. */
export class PaintRoom implements Command {
  readonly label: string;
  private readonly state: HouseState;
  private readonly roomId: string;
  private readonly before: RoomOverride;
  private readonly after: RoomOverride;

  constructor(state: HouseState, roomId: string, after: RoomOverride, label: string) {
    this.state = state;
    this.roomId = roomId;
    this.after = after;
    this.label = label;
    // Guarda só os campos que vão mudar (undefined = "sem personalização", volta à planta).
    const current = state.get(roomId);
    this.before = Object.fromEntries(Object.keys(after).map((k) => [k, current[k as keyof RoomOverride]]));
  }

  do(): void {
    this.state.set(this.roomId, this.after);
  }

  undo(): void {
    this.state.set(this.roomId, this.before);
  }
}
