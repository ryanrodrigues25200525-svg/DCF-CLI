import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
    Sentry.init({
        dsn,
        tracesSampleRate: 0.1,
        environment: process.env.NODE_ENV || "development",
        enabled: process.env.NODE_ENV === "production",
        // Use a lower error sample rate for client-side to avoid noise
        maxValueLength: 500,
    });
}
