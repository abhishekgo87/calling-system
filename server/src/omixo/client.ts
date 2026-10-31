import { config } from '../config';
import type {
  OmixoMeResponse,
  OmixoPlaceCallResponse,
  OmixoGetCallResponse,
  OmixoCdrResponse,
  NormalizedAccount,
  NormalizedCdrRecord,
  OmixoCallInitial,
  OmixoCallDetail,
  OmixoClickToCallRequest,
  OmixoClickToCallResponse,
  OmixoHangupResponse,
  OmixoResult,
} from './types';

// In-memory store for mock mode progression
interface MockCallState {
  id: string;
  to: string;
  say: string;
  createdAt: number;
  mode: string;
  ringingDelaySec?: number;
}

interface MockBridgeState {
  callId: string;
  agent: string;
  destination: string;
  createdAt: number;
  hungup: boolean;
}

const mockCallsStore = new Map<string, MockCallState>();
const mockBridgeStore = new Map<string, MockBridgeState>();

/**
 * Format Date to Omixo's IST string format "YYYY-MM-DD HH:mm:ss"
 */
export function formatToIstString(date: Date): string {
  // Convert to IST (+5.5 hours)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffsetMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = istDate.getUTCFullYear();
  const month = pad(istDate.getUTCMonth() + 1);
  const day = pad(istDate.getUTCDate());
  const hours = pad(istDate.getUTCHours());
  const minutes = pad(istDate.getUTCMinutes());
  const seconds = pad(istDate.getUTCSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Fetch wrapper for Omixo AI REST API with 15-second timeout and typed discriminated union return.
 */
async function omixoFetch<T>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
  } = {}
): Promise<OmixoResult<T>> {
  const url = `${config.OMIXO_BASE_URL.replace(/\/$/, '')}${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.OMIXO_API_KEY,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const json = (await res.json().catch(() => null)) as
      | (T & { ok?: boolean; error?: string; message?: string })
      | { ok?: boolean; error?: string; message?: string }
      | null;

    if (!res.ok || (json && json.ok === false)) {
      const errorSlug = json && typeof json.error === 'string' ? json.error : 'unknown_error';
      const message =
        json && typeof json.message === 'string'
          ? json.message
          : `Request failed with status ${res.status}`;

      return {
        ok: false,
        status: res.status,
        error: errorSlug,
        message,
        rawError: json,
      };
    }

    if (!json) {
      return {
        ok: false,
        status: res.status,
        error: 'empty_response',
        message: 'Empty response received from Omixo API',
      };
    }

    return {
      ok: true,
      data: json as T,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = (err as Error).name === 'AbortError';
    return {
      ok: false,
      status: isAbort ? 408 : 500,
      error: isAbort ? 'timeout' : 'network_error',
      message: isAbort
        ? 'Request to Omixo AI timed out after 15 seconds'
        : 'Network failure communicating with Omixo AI',
      rawError: err,
    };
  }
}

/**
 * Account check: GET /me
 */
export async function getMe(): Promise<OmixoResult<NormalizedAccount>> {
  if (config.OMIXO_MOCK) {
    return {
      ok: true,
      data: {
        name: 'Demo Account (Mock)',
        status: 'active',
        walletBalance: 248.5,
        currency: 'INR',
      },
    };
  }

  const result = await omixoFetch<OmixoMeResponse>('/me');
  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    data: {
      name: result.data.account.name,
      status: result.data.account.status,
      walletBalance: result.data.account.wallet_balance,
      currency: result.data.account.currency,
    },
  };
}

/**
 * Place one automated OBD call: POST /calls/obd
 */
export async function placeObdCall(
  to: string,
  say: string,
  vars?: Record<string, string>
): Promise<OmixoResult<OmixoCallInitial>> {
  if (config.OMIXO_MOCK) {
    const mockId = `mock_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const mockCall: MockCallState = {
      id: mockId,
      to,
      say,
      createdAt: Date.now(),
      mode: 'obd',
      ringingDelaySec: Math.random() * 3, // Random 0 to 3s delay before ringing
    };
    mockCallsStore.set(mockId, mockCall);

    return {
      ok: true,
      data: {
        id: mockId,
        to,
        mode: 'obd',
        status: 'queued',
      },
    };
  }

  const result = await omixoFetch<OmixoPlaceCallResponse>('/calls/obd', {
    method: 'POST',
    body: {
      to,
      say,
      vars,
      max_attempts: 1, // Always send 1 so missed call is never redialed
    },
  });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    data: result.data.call,
  };
}

/**
 * Get status of one call: GET /calls/obd/{id}
 * Status flow: queued -> ringing -> answered -> completed
 * Uses random 0 to 3 second ringing delays in mock mode for realistic capacity tests.
 */
export async function getObdCall(id: string): Promise<OmixoResult<OmixoCallDetail>> {
  if (config.OMIXO_MOCK) {
    const existing = mockCallsStore.get(id);
    const createdAt = existing ? existing.createdAt : Date.now() - 15000;
    const elapsedSeconds = (Date.now() - createdAt) / 1000;
    const to = existing ? existing.to : '9876543210';
    const ringingDelay = existing?.ringingDelaySec ?? 1.5;

    let status = 'queued';
    let disposition: string | undefined = undefined;
    let durationSec: number | undefined = 0;
    let answeredAt: string | undefined = undefined;
    let completedAt: string | undefined = undefined;

    if (elapsedSeconds < ringingDelay) {
      status = 'queued';
    } else if (elapsedSeconds < ringingDelay + 4) {
      status = 'ringing';
    } else if (elapsedSeconds < ringingDelay + 7) {
      status = 'answered';
      durationSec = Math.floor(elapsedSeconds - (ringingDelay + 4));
      answeredAt = new Date(createdAt + Math.floor((ringingDelay + 4) * 1000)).toISOString();
    } else {
      status = 'completed';
      disposition = 'ANSWERED';
      durationSec = 14;
      answeredAt = new Date(createdAt + Math.floor((ringingDelay + 4) * 1000)).toISOString();
      completedAt = new Date(createdAt + Math.floor((ringingDelay + 18) * 1000)).toISOString();
    }

    return {
      ok: true,
      data: {
        id,
        to,
        mode: 'obd',
        status,
        disposition,
        duration_sec: durationSec,
        answered_at: answeredAt,
        completed_at: completedAt,
      },
    };
  }

  const result = await omixoFetch<OmixoGetCallResponse>(`/calls/obd/${id}`);
  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    data: result.data.call,
  };
}

/**
 * Call detail records: GET /calls/records?limit=N
 */
export async function getCallRecords(
  limit = 50
): Promise<OmixoResult<NormalizedCdrRecord[]>> {
  if (config.OMIXO_MOCK) {
    const now = Date.now();
    const records: NormalizedCdrRecord[] = [];

    // Add entries from our recent mock calls
    for (const [id, call] of mockCallsStore.entries()) {
      const elapsed = (now - call.createdAt) / 1000;
      const isCompleted = elapsed >= 10;
      const startedAtDate = new Date(call.createdAt);
      const istString = formatToIstString(startedAtDate);

      records.push({
        cdrId: `cdr_mock_${id}`,
        direction: 'outbound',
        from: '918000000000',
        to: call.to,
        durationSec: isCompleted ? 14 : Math.max(0, Math.floor(elapsed)),
        disposition: isCompleted ? 'ANSWERED' : 'RINGING',
        cost: 0.35,
        startedAt: `${istString.replace(' ', 'T')}+05:30`,
      });
    }

    // Add entries from recent mock bridge calls (appearing after ~10 seconds)
    for (const [bridgeId, bridge] of mockBridgeStore.entries()) {
      const elapsed = (now - bridge.createdAt) / 1000;
      if (elapsed >= 10) {
        const startedAtDate = new Date(bridge.createdAt);
        const istString = formatToIstString(startedAtDate);

        records.push({
          cdrId: `cdr_mock_bridge_${bridgeId}`,
          direction: 'outbound',
          from: '915226523628',
          to: bridge.destination,
          durationSec: bridge.hungup ? 5 : 24,
          disposition: bridge.hungup ? 'USER_HANGUP' : 'ANSWERED',
          cost: 0.6,
          startedAt: `${istString.replace(' ', 'T')}+05:30`,
        });
      }
    }

    // Default sample mock rows
    if (records.length < 3) {
      records.push(
        {
          cdrId: 'cdr_mock_seed_1',
          direction: 'outbound',
          from: '918000000000',
          to: '9876543210',
          durationSec: 22,
          disposition: 'ANSWERED',
          cost: 0.45,
          startedAt: new Date(now - 12 * 60 * 1000).toISOString().replace('Z', '+05:30'),
        },
        {
          cdrId: 'cdr_mock_seed_2',
          direction: 'inbound',
          from: '9123456789',
          to: '918000000000',
          durationSec: 45,
          disposition: 'ANSWERED',
          cost: 0.0,
          startedAt: new Date(now - 45 * 60 * 1000).toISOString().replace('Z', '+05:30'),
        }
      );
    }

    return {
      ok: true,
      data: records.slice(0, limit),
    };
  }

  const result = await omixoFetch<OmixoCdrResponse>(`/calls/records?limit=${limit}`);
  if (!result.ok) {
    return result;
  }

  // Normalize Omixo records
  // Supports both official spec fields (cdr_id, from, to, duration, started_at)
  // and live Omixo API responses (id, src, dst, billsec, start_at, cost string)
  const normalized: NormalizedCdrRecord[] = result.data.records.map((rec) => {
    const rawStarted = rec.start_at || rec.started_at || new Date().toISOString();
    let isoStartedAt = rawStarted;

    // If format is "YYYY-MM-DD HH:mm:ss", convert to "YYYY-MM-DDTHH:mm:ss+05:30"
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(rawStarted)) {
      isoStartedAt = `${rawStarted.replace(' ', 'T')}+05:30`;
    }

    const duration =
      typeof rec.duration === 'number'
        ? rec.duration
        : typeof rec.billsec === 'number'
        ? rec.billsec
        : 0;

    const costNum =
      typeof rec.cost === 'number'
        ? rec.cost
        : parseFloat(String(rec.cost || '0')) || 0;

    return {
      cdrId: String(rec.id ?? rec.cdr_id ?? Math.floor(Math.random() * 1000000)),
      direction: rec.direction,
      from: rec.src || rec.from || 'Unknown',
      to: rec.dst || rec.to || 'Unknown',
      durationSec: duration,
      disposition: rec.disposition,
      cost: costNum,
      startedAt: isoStartedAt,
    };
  });

  return {
    ok: true,
    data: normalized,
  };
}

/**
 * Originate a bridge call (click-to-call): POST /calls/click-to-call
 */
export async function clickToCall(
  params: OmixoClickToCallRequest
): Promise<OmixoResult<OmixoClickToCallResponse>> {
  if (config.OMIXO_MOCK) {
    // Mock switch: specific number "9000000000" forces 402 no_plan error
    if (params.agent === '9000000000' || params.destination === '9000000000') {
      return {
        ok: false,
        status: 402,
        error: 'no_plan',
        message:
          'This account has no active calling plan, so bridge calls are not available. Ask the account owner to enable calling.',
      };
    }

    const mockCallId = `${Math.floor(Date.now() / 1000)}.${Math.floor(Math.random() * 900 + 100)}`;
    mockBridgeStore.set(mockCallId, {
      callId: mockCallId,
      agent: params.agent,
      destination: params.destination,
      createdAt: Date.now(),
      hungup: false,
    });

    return {
      ok: true,
      data: {
        ok: true,
        message: 'Call originated — ringing your agent first, then bridging the customer.',
        call_id: mockCallId,
        channel: mockCallId,
        agent: params.agent,
        destination: params.destination,
        caller_id: params.caller_id || '915226523628',
      },
    };
  }

  const result = await omixoFetch<OmixoClickToCallResponse>('/calls/click-to-call', {
    method: 'POST',
    body: {
      agent: params.agent,
      destination: params.destination,
      caller_id: params.caller_id,
    },
  });

  return result;
}

/**
 * Hang up an active click-to-call bridge call: POST /calls/hangup
 */
export async function hangupCall(
  callId: string
): Promise<OmixoResult<OmixoHangupResponse>> {
  if (config.OMIXO_MOCK) {
    const bridge = mockBridgeStore.get(callId);
    if (bridge) {
      bridge.hungup = true;
    }
    return {
      ok: true,
      data: {
        ok: true,
        hungup: true,
        call_id: callId,
      },
    };
  }

  const result = await omixoFetch<OmixoHangupResponse>('/calls/hangup', {
    method: 'POST',
    body: {
      call_id: callId,
    },
  });

  return result;
}
