import type { Instrumentation } from 'next';

// Error monitoring (Sentry). Off unless SENTRY_DSN is set on the host. No personal data is sent: only the error,
// the route and the request path.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.SENTRY_DSN) {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || 'production',
      sendDefaultPii: false,
      tracesSampleRate: 0,
    });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/node');
  Sentry.captureException(err, {
    tags: { route: context.routePath, kind: context.routeType },
    extra: { path: request.path.split('?')[0], method: request.method },
  });
};
