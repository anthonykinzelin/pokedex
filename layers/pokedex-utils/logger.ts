// Structured logging with no dependency. One JSON object per line, so
// CloudWatch Logs Insights can filter on any field.
import { asAwsError } from './errors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(extra: LogContext): Logger;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// LOG_LEVEL is an arbitrary string from the environment, so it is checked
// against the table instead of being used as a key. An unknown value falls
// back to info rather than silencing the function.
function isLogLevel(value: string): value is LogLevel {
  return value in LEVELS;
}

const configuredLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const MIN_LEVEL = isLogLevel(configuredLevel) ? LEVELS[configuredLevel] : LEVELS.info;

// JSON.stringify ignores an Error: name, message and stack are not enumerable
// properties, so an error has to be flattened by hand before it can be logged.
export function serializeError(error: unknown): LogContext {
  const awsError = asAwsError(error);

  return {
    errorName: awsError?.name,
    errorMessage: awsError?.message,
    stack: awsError?.stack,
  };
}

function write(
  level: LogLevel,
  message: string,
  context: LogContext | undefined,
  base: LogContext,
): void {
  if (LEVELS[level] < MIN_LEVEL) {
    return;
  }

  // JSON.stringify escapes the newlines inside a stack trace, so the record
  // stays on a single physical line and CloudWatch keeps it as one event.
  const line = JSON.stringify({
    level,
    message,
    ...base,
    ...context,
    timestamp: new Date().toISOString(),
  });

  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function createLogger(base: LogContext = {}): Logger {
  return {
    debug: (message, context) => write('debug', message, context, base),
    info: (message, context) => write('info', message, context, base),
    warn: (message, context) => write('warn', message, context, base),
    error: (message, context) => write('error', message, context, base),
    child: (extra) => createLogger({ ...base, ...extra }),
  };
}

export const logger = createLogger();
