export type DbValue = string | number | bigint | Uint8Array | null;

export interface DbStatement {
  sql: string
  params?: DbValue[]
}

export type DbWorkerRequest
  = | {
    id: number
    type: "exec"
    payload: {
      sql: string
    }
  }
  | {
    id: number
    type: "run"
    payload: DbStatement
  }
  | {
    id: number
    type: "get"
    payload: DbStatement
  }
  | {
    id: number
    type: "all"
    payload: DbStatement
  }
  | {
    id: number
    type: "batch"
    payload: {
      commands: DbStatement[]
      transactional?: boolean
    }
  }
  | {
    id: number
    type: "close"
  };

export interface SerializedDbError {
  name: string
  message: string
  stack?: string
  code?: string
}

export type DbWorkerResponse
  = | {
    type: "ready"
  }
  | {
    type: "result"
    id: number
    result: unknown
  }
  | {
    type: "error"
    id: number
    error: SerializedDbError
  }
  | {
    type: "fatal"
    error: SerializedDbError
  };
