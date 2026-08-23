/**
 * Application Logger Service
 * consistent logging interface with log levels and environment control.
 * Optionally integrates with Sentry for error reporting when @sentry/nextjs
 * is installed and NEXT_PUBLIC_SENTRY_DSN is configured.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// --- Optional Sentry integration (graceful degradation) ---
let sentryCapture: ((err: Error, tags?: Record<string, string>) => void) | null = null;

async function initSentry(): Promise<void> {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn) return;

    try {
        // Dynamic import — builds fine even if @sentry/nextjs is not installed
        const sentryNext = await import("@sentry/nextjs");
        sentryNext.init({
            dsn,
            tracesSampleRate: 0.1,
            environment: process.env.NODE_ENV || "development",
            enabled: process.env.NODE_ENV === "production",
        });
        sentryCapture = (err, tags) => {
            sentryNext.withScope((scope) => {
                if (tags) {
                    Object.entries(tags).forEach(([k, v]) => scope.setTag(k, v));
                }
                sentryNext.captureException(err);
            });
        };
    } catch {
        // @sentry/nextjs not installed — silently continue without Sentry
    }
}

// Kick off init on module load (fire-and-forget; errors handled internally)
void initSentry();

class LoggerService {
    private isDev: boolean;

    constructor() {
        this.isDev = process.env.NODE_ENV !== 'production';
    }

    private formatMessage(level: LogLevel, message: string, data?: unknown): void {
        if (!this.isDev && level === 'debug') return; // Silence debug in prod

        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

        if (data) {
            console[level](prefix, message, data);
        } else {
            console[level](prefix, message);
        }
    }

    public debug(message: string, data?: unknown): void {
        this.formatMessage('debug', message, data);
    }

    public info(message: string, data?: unknown): void {
        this.formatMessage('info', message, data);
    }

    public warn(message: string, data?: unknown): void {
        this.formatMessage('warn', message, data);
    }

    public error(message: string, error?: unknown, context?: Record<string, string>): void {
        this.formatMessage('error', message, error);

        // Capture to Sentry with optional context tags (including X-Request-ID)
        if (sentryCapture) {
            const err = error instanceof Error
                ? error
                : new Error(String(error ?? message));
            const tags: Record<string, string> = {
                ...context,
                logger_message: message,
            };
            sentryCapture(err as Error, tags);
        }
    }
}

export const Logger = new LoggerService();
