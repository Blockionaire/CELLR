// Minimal types for the parts of node-postgres these tools use (the package ships no types; no extra dependency).
declare module "pg" {
  export interface QueryResult<R> {
    rows: R[];
    rowCount: number | null;
  }
  export class Client {
    constructor(config: { connectionString: string });
    connect(): Promise<void>;
    query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
    end(): Promise<void>;
  }
  const pg: { Client: typeof Client };
  export default pg;
}
