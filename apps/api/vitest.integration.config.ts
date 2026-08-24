import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// NestJS DI resolves untyped constructor params (e.g. `Reflector`) via
// emitDecoratorMetadata, which Vite/Vitest's default esbuild transform does
// not emit correctly — guards silently receive `undefined` deps instead of
// a resolution error. swc's decorator transform matches `tsc`'s output, so
// tests exercise the same DI behavior as the built app. See NestJS's own
// Vitest recipe: https://docs.nestjs.com/recipes/swc#vitest
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    include: ['test/integration/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration tests share one Postgres connection pool across a real
    // Nest application instance; running them in parallel workers would
    // race on that shared DB state, so force a single worker.
    poolOptions: { threads: { singleThread: true } },
  },
});
