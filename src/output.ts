export class CliError extends Error {
  constructor(public code: string, message: string, public exitCode = 1) {
    super(message);
  }
}

export interface Problem {
  code: string;
  message: string;
  deviceId?: string;
  retryable?: boolean;
}

export interface Result {
  schemaVersion: 1;
  ok: boolean;
  data: unknown;
  errors: Problem[];
}

export function result(data: unknown, errors: Problem[] = []): Result {
  return { schemaVersion: 1, ok: errors.length === 0, data, errors };
}

export function print(value: Result, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value));
    return;
  }
  if (typeof value.data === 'string') console.log(value.data);
  else if (value.data !== null) console.log(JSON.stringify(value.data, null, 2));
  for (const error of value.errors) console.error(`${error.code}: ${error.message}`);
}
