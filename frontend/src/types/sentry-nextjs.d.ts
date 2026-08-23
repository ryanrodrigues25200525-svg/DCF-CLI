/**
 * Type declaration for @sentry/nextjs as an optional dependency.
 * This file is only used when @sentry/nextjs is NOT installed.
 * When the real package is installed, its own types take precedence.
 */
declare module "@sentry/nextjs" {
    interface SentryOptions {
        dsn?: string;
        tracesSampleRate?: number;
        environment?: string;
        enabled?: boolean;
        maxValueLength?: number;
    }

    interface Scope {
        setTag(key: string, value: string): void;
    }

    function init(options: SentryOptions): void;
    function captureException(exception: unknown): string;
    function withScope(callback: (scope: Scope) => void): void;

    export { init, captureException, withScope };
}
