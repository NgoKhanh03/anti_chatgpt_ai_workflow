import { redactValue } from './redaction.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  event: string;
  runId?: string;
  data?: unknown;
}

export type LogSink = (line: string) => void;

export class StructuredLogger {
  constructor(
    private readonly sink: LogSink = (line) => console.log(line),
    private readonly context: Record<string, unknown> = {},
  ) {}

  child(context: Record<string, unknown>): StructuredLogger {
    return new StructuredLogger(this.sink, { ...this.context, ...context });
  }

  log(level: LogLevel, event: string, data?: unknown): void {
    const record = redactValue({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...this.context,
      ...(data === undefined ? {} : { data }),
    });
    this.sink(JSON.stringify(record));
  }

  debug(event: string, data?: unknown): void { this.log('debug', event, data); }
  info(event: string, data?: unknown): void { this.log('info', event, data); }
  warn(event: string, data?: unknown): void { this.log('warn', event, data); }
  error(event: string, data?: unknown): void { this.log('error', event, data); }
}
