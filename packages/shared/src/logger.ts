import { pino, type Logger, type LevelWithSilent } from "pino";

export type { Logger };

export function createLogger(options: {
  name: string;
  level: LevelWithSilent;
}): Logger {
  return pino({ name: options.name, level: options.level });
}
