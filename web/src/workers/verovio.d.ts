// verovio@6.3.0 ships no TypeScript declarations. Minimal ambient types for the
// calls the export layout worker makes; extend as B4 needs more of the toolkit.
declare module "verovio/wasm" {
  export interface VerovioModule {
    readonly _brand?: "VerovioModule";
  }
  const createVerovioModule: () => Promise<VerovioModule>;
  export default createVerovioModule;
}

declare module "verovio/esm" {
  import type { VerovioModule } from "verovio/wasm";
  export class VerovioToolkit {
    constructor(module: VerovioModule);
    loadData(data: string): boolean;
    renderToSVG(page?: number): string;
    getPageCount(): number;
    getVersion(): string;
    setOptions(options: Record<string, string | number | boolean | readonly string[]>): boolean;
    destroy(): void;
  }
}
