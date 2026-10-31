export interface AccountData {
  name: string;
  status: string;
  walletBalance: number;
  currency: string;
}

export interface ConfigData {
  allowedNumbers: string[];
}

export interface CallRecord {
  _id?: string;
  omixoCallId: string;
  to: string;
  message?: string;
  status: string;
  disposition?: string;
  durationSec?: number;
  cost?: number;
  answeredAt?: string;
  completedAt?: string;
  placedAt: string;
  source: 'obd' | 'click_to_call';
  agentNumber?: string;
  callerId?: string;
  lastError?: string;
}

export interface BridgeResultResponse {
  found: boolean;
  record?: OmixoCdr;
}

export interface OmixoCdr {
  cdrId: string;
  direction: 'inbound' | 'outbound';
  from: string;
  to: string;
  durationSec: number;
  disposition: string;
  cost: number;
  startedAt: string; // ISO string with +05:30 offset
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface CapacityCallRecord {
  number: string;
  requestOk: boolean;
  requestError?: string;
  omixoCallId?: string;
  requestSentAtMs: number;
  requestDoneAtMs: number;
  firstSeen: {
    queued?: number;
    ringing?: number;
    answered?: number;
    final?: number;
  };
  finalStatus?: string;
  disposition?: string;
  durationSec?: number;
}

export interface CapacityRunRecord {
  id?: string;
  _id?: string;
  startedAt: string;
  numbers: string[];
  calls: CapacityCallRecord[];
  finishedAt?: string;
}

