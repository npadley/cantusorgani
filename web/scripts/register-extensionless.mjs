// Node `--import` hook: resolve extensionless relative imports (`./settings`) to `.ts` files, so
// dev scripts can run the production export-layout modules unbundled. Dev harness only.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});
