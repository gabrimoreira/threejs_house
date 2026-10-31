import { Emitter } from '../../utils/emitter';
import type { Command } from './Command';

const LIMIT = 100;

/**
 * Histórico de desfazer/refazer: duas pilhas de comandos.
 * Executar um comando novo apaga o que dava para refazer (a "linha do tempo" mudou).
 */
export class History extends Emitter<{ changed: undefined }> {
  private done: Command[] = [];
  private undone: Command[] = [];

  execute(command: Command): void {
    command.do();
    this.done.push(command);
    if (this.done.length > LIMIT) this.done.shift();
    this.undone = [];
    this.emit('changed', undefined);
  }

  undo(): void {
    const command = this.done.pop();
    if (!command) return;
    command.undo();
    this.undone.push(command);
    this.emit('changed', undefined);
  }

  redo(): void {
    const command = this.undone.pop();
    if (!command) return;
    command.do();
    this.done.push(command);
    this.emit('changed', undefined);
  }

  /** Esquece tudo (ex.: ao carregar outro save). */
  clear(): void {
    this.done = [];
    this.undone = [];
    this.emit('changed', undefined);
  }

  get undoLabel(): string | null {
    return this.done.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.undone.at(-1)?.label ?? null;
  }
}
