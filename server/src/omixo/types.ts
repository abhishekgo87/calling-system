// Omixo API response types

export interface OmixoAccountRaw {
  company_id: string;
  name: string;
  status: string;
  wallet_balance: number;
  currency: string;
}

export interface OmixoMeResponse {
  ok: boolean;
  account: OmixoAccountRaw;
  message?: string;
  error?: string;
}

export interface OmixoCallInitial {
  id: string | number;
  to: string;
  mode: string;
  status: string;
}

export interface OmixoPlaceCallResponse {
  ok: boolean;
  message?: string;
  call: OmixoCallInitial;
  error?: string;
}

export interface OmixoCallDetail {
  id: string | number;
  to: string;
  mode: string;
  status: string;
  disposition?: string;
  dtmf?: string;
  duration_sec?: number;
  answered_at?: string;
  completed_at?: string;
}

export interface OmixoGetCallResponse {
  ok: boolean;
  call: OmixoCallDetail;
  message?: string;
  error?: string;
}

export interface OmixoRawCdrRecord {
  id?: number | string;
  cdr_id?: string;
  direction: 'inbound' | 'outbound';
  from?: string;
  src?: string;
  to?: string;
  dst?: string;
  duration?: number; // in seconds
  billsec?: number;
  disposition: string;
  cost: number | string; // in INR
  started_at?: string; // format "YYYY-MM-DD HH:mm:ss" in IST or ISO
  start_at?: string;
}

export interface OmixoCdrResponse {
  ok: boolean;
  records: OmixoRawCdrRecord[];
  message?: string;
  error?: string;
}

export interface OmixoClickToCallRequest {
  agent: string;
  destination: string;
  caller_id?: string;
}

export interface OmixoClickToCallResponse {
  ok: boolean;
  message?: string;
  call_id: string;
  channel?: string;
  agent: string;
  destination: string;
  caller_id?: string;
  error?: string;
}

export interface OmixoHangupRequest {
  call_id: string;
}

export interface OmixoHangupResponse {
  ok: boolean;
  hungup: boolean;
  call_id: string;
  message?: string;
  error?: string;
}

// Normalized Client / Service Return Types

export interface NormalizedAccount {
  name: string;
  status: string;
  walletBalance: number;
  currency: string;
}

export interface NormalizedCdrRecord {
  cdrId: string;
  direction: 'inbound' | 'outbound';
  from: string;
  to: string;
  durationSec: number;
  disposition: string;
  cost: number;
  startedAt: string; // ISO string with +05:30 offset
}

export type OmixoResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message: string; rawError?: unknown };
