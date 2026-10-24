import type { Instrumentation } from 'next';

// Error monitoring (Sentry). Off unless SENTRY_DSN is set on the host (instrumentation-node.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.SENTRY_DSN) {
    (await import('./instrumentation-node')).init();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.SENTRY_DSN) {
    (await import('./instrumentation-node')).capture(err, { route: context.routePath, kind: context.routeType },
      { path: request.path.split('?')[0], method: request.method });
  }
};
