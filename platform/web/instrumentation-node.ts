import * as Sentry from '@sentry/node';

// Error monitoring (Sentry), Node runtime only: the middleware runs on the edge runtime, which has no Node modules.
// No personal data is sent: only the error, the route and the request path.
export function init() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}

export function capture(err: unknown, tags: Record<string, string>, extra: Record<string, string>) {
  Sentry.captureException(err, { tags, extra });
}
