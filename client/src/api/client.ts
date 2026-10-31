import type {
  AccountData,
  ConfigData,
  CallRecord,
  OmixoCdr,
  ApiResponse,
  CapacityRunRecord,
} from './types';

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const json: ApiResponse<T> | null = await response.json().catch(() => null);

  if (!response.ok || (json && json.ok === false)) {
    const message = json?.message || `Request failed with status ${response.status}`;
    const error = new Error(message);
    (error as Error & { status?: number; errorSlug?: string }).status = response.status;
    (error as Error & { status?: number; errorSlug?: string }).errorSlug = json?.error;
    throw error;
  }

  if (!json || json.data === undefined) {
    // If response body is direct payload (e.g. /api/config)
    if (json && !('data' in json)) {
      return json as unknown as T;
    }
    throw new Error('Received invalid empty response from server');
  }

  return json.data;
}

export async function fetchConfig(): Promise<ConfigData> {
  return request<ConfigData>('/api/config');
}

export async function fetchAccount(): Promise<AccountData> {
  return request<AccountData>('/api/account');
}

export async function placeCall(to: string, message: string): Promise<CallRecord> {
  return request<CallRecord>('/api/calls', {
    method: 'POST',
    body: JSON.stringify({ to, message }),
  });
}

export async function fetchCall(omixoCallId: string): Promise<CallRecord> {
  return request<CallRecord>(`/api/calls/${encodeURIComponent(omixoCallId)}`);
}

export async function fetchCalls(limit = 50): Promise<CallRecord[]> {
  return request<CallRecord[]>(`/api/calls?limit=${limit}`);
}

export async function fetchRecords(limit = 50): Promise<OmixoCdr[]> {
  return request<OmixoCdr[]>(`/api/records?limit=${limit}`);
}

export async function startBridgeCall(agent: string, customer: string): Promise<CallRecord> {
  return request<CallRecord>('/api/bridge', {
    method: 'POST',
    body: JSON.stringify({ agent, customer }),
  });
}

export async function hangupBridgeCall(omixoCallId: string): Promise<CallRecord> {
  return request<CallRecord>(`/api/bridge/${encodeURIComponent(omixoCallId)}/hangup`, {
    method: 'POST',
  });
}

export async function fetchBridgeResult(
  omixoCallId: string
): Promise<{ found: boolean; record?: OmixoCdr }> {
  return request<{ found: boolean; record?: OmixoCdr }>(
    `/api/bridge/${encodeURIComponent(omixoCallId)}/result`
  );
}

export async function startCapacityTest(numbers: string[]): Promise<CapacityRunRecord> {
  return request<CapacityRunRecord>('/api/capacity/outbound', {
    method: 'POST',
    body: JSON.stringify({ numbers }),
  });
}

export async function fetchCapacityRun(runId: string): Promise<CapacityRunRecord> {
  return request<CapacityRunRecord>(`/api/capacity/${encodeURIComponent(runId)}`);
}

export async function fetchCapacityRuns(): Promise<CapacityRunRecord[]> {
  return request<CapacityRunRecord[]>('/api/capacity');
}

