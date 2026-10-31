/**
 * Padrão Command: cada alteração do usuário vira um objeto que sabe se aplicar
 * (do) e se desfazer (undo). O histórico guarda esses objetos em pilhas.
 */
export interface Command {
  /** Texto curto para a interface ("Mover Sofá"). */
  readonly label: string;
  do(): void;
  undo(): void;
}
