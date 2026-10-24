// Values global-setup.ts hands to test files through Vitest's provide/inject.
declare module 'vitest' {
  // Module augmentation only merges into an interface
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  export interface ProvidedContext {
    postgresAdminUrl: string;
    payflowUrl: string;
    simulatorUrl: string;
    valkeyUrl: string;
  }
}

/** The migrated copy of the payflow database that each test file clones. */
export const TEMPLATE_DB = 'payflow_template';
