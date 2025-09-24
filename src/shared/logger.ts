export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type Listener = (payload: { level: LogLevel; message: string; data?: unknown }) => void;

class Logger {
  #level: LogLevel = 'info';
  #listeners = new Set<Listener>();

  setLevel(level: LogLevel) {
    this.#level = level;
  }

  addListener(listener: Listener) {
    this.#listeners.add(listener);
  }

  removeListener(listener: Listener) {
    this.#listeners.delete(listener);
  }

  debug(message: string, data?: unknown) {
    this.#log('debug', message, data);
  }

  info(message: string, data?: unknown) {
    this.#log('info', message, data);
  }

  warn(message: string, data?: unknown) {
    this.#log('warn', message, data);
  }

  error(message: string, data?: unknown) {
    this.#log('error', message, data);
  }

  #log(level: LogLevel, message: string, data?: unknown) {
    if (this.#shouldLog(level)) {
      const prefix = `[${new Date().toISOString()}][${level.toUpperCase()}]`;
      // eslint-disable-next-line no-console
      console[level === 'debug' ? 'info' : level](`${prefix} ${message}`, data ?? '');
    }

    this.#listeners.forEach((listener) => listener({ level, message, data }));
  }

  #shouldLog(level: LogLevel) {
    const order: Record<LogLevel, number> = {
      debug: 10,
      info: 20,
      warn: 30,
      error: 40
    };
    return order[level] >= order[this.#level];
  }
}

export const logger = new Logger();
