/**
 * Next.js Instrumentation Hook
 * Loaded once when the server starts (and in Edge runtime when applicable).
 * Initializes Sentry on the server side if the DSN is configured.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
    // Server-side Sentry init is handled by sentry.server.config.ts.
    // This hook can be extended with other server bootstrap logic.
    if (process.env.NEXT_RUNTIME === "nodejs") {
        // Dynamic import to avoid bundling in edge runtime
        try {
            const Sentry = await import("@sentry/nextjs");
            const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
            if (dsn) {
                Sentry.init({
                    dsn,
                    tracesSampleRate: 0.1,
                    environment: process.env.NODE_ENV || "development",
                    enabled: process.env.NODE_ENV === "production",
                });
            }
        } catch {
            // @sentry/nextjs not installed — no-op
        }
    }
}
