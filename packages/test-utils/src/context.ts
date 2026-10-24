// Values global-setup.ts hands to test files through Vitest's provide/inject.
declare module 'vitest' {
  export interface ProvidedContext {
    postgresAdminUrl: string;
    payflowUrl: string;
    simulatorUrl: string;
    valkeyUrl: string;
  }
}

/** The migrated copy of the payflow database that each test file clones. */
export const TEMPLATE_DB = 'payflow_template';
