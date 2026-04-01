import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let _activeLevel: Level = 'info';
let _logDir: string | null = null;
let _currentDate = '';
let _currentLogPath = '';

export function setLogLevel(level: Level): void {
  _activeLevel = level;
}

export function initFileLogs(logDir: string): void {
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  _logDir = logDir;
  _currentDate = '';
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timestamp(): string {
  const now = new Date();
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  const s = now.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function shouldLog(level: Level): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[_activeLevel];
}

function formatLine(level: Level, module: string, msg: string, obj?: object): string {
  const tag = level.toUpperCase().padEnd(5);
  const base = `[${timestamp()}] ${tag} [${module}] ${msg}`;
  return obj ? `${base} ${JSON.stringify(obj)}` : base;
}

function emit(level: Level, line: string): void {
  if (_logDir !== null) {
    const date = todayStr();
    if (date !== _currentDate) {
      _currentDate = date;
      _currentLogPath = join(_logDir, `${date}.log`);
    }
    try {
      appendFileSync(_currentLogPath, line + '\n');
    } catch {
      if (level === 'warn' || level === 'error') {
        console.error(line);
      } else {
        console.log(line);
      }
    }
  } else {
    if (level === 'warn' || level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}

export interface Logger {
  debug(msg: string): void;
  debug(obj: object, msg: string): void;
  info(msg: string): void;
  info(obj: object, msg: string): void;
  warn(msg: string): void;
  warn(obj: object, msg: string): void;
  error(msg: string): void;
  error(obj: object, msg: string): void;
}

export function logger(module: string): Logger {
  const log = (level: Level, objOrMsg: object | string, msg?: string) => {
    if (!shouldLog(level)) return;
    if (typeof objOrMsg === 'string') {
      emit(level, formatLine(level, module, objOrMsg));
    } else {
      emit(level, formatLine(level, module, msg || '', objOrMsg));
    }
  };

  return {
    debug: ((objOrMsg: any, msg?: string) => log('debug', objOrMsg, msg)) as Logger['debug'],
    info: ((objOrMsg: any, msg?: string) => log('info', objOrMsg, msg)) as Logger['info'],
    warn: ((objOrMsg: any, msg?: string) => log('warn', objOrMsg, msg)) as Logger['warn'],
    error: ((objOrMsg: any, msg?: string) => log('error', objOrMsg, msg)) as Logger['error'],
  };
}
