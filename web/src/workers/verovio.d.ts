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
  export interface VerovioAvailableOption {
    readonly type: string;
    readonly default: unknown;
    readonly values?: readonly string[];
    readonly min?: number;
    readonly max?: number;
  }
  export interface VerovioAvailableOptions {
    readonly groups: Readonly<Record<string, { readonly options: Readonly<Record<string, VerovioAvailableOption>> }>>;
  }
  export class VerovioToolkit {
    constructor(module: VerovioModule);
    loadData(data: string): boolean;
    renderToSVG(page?: number): string;
    getPageCount(): number;
    getVersion(): string;
    setOptions(options: Record<string, string | number | boolean | readonly string[]>): boolean;
    destroy(): void;
    /** Verovio 6.3.0 reports rejected options on console.error only; getLog() is empty in the WASM build. */
    getLog(): string;
    /** Current option values. Read these back after setOptions: a rejected option silently keeps its old value. */
    getOptions(defaultValues?: boolean): Record<string, unknown>;
    getAvailableOptions(): VerovioAvailableOptions;
  }
}
