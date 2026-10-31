import { Schema, model, Document } from 'mongoose';

export interface ICapacityCall {
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

export interface ICapacityRun {
  startedAt: Date;
  numbers: string[];
  calls: ICapacityCall[];
  finishedAt?: Date;
}

export interface ICapacityRunDocument extends ICapacityRun, Document {}

const CapacityCallSchema = new Schema<ICapacityCall>(
  {
    number: { type: String, required: true },
    requestOk: { type: Boolean, required: true },
    requestError: { type: String, required: false },
    omixoCallId: { type: String, required: false },
    requestSentAtMs: { type: Number, required: true },
    requestDoneAtMs: { type: Number, required: true },
    firstSeen: {
      queued: { type: Number, required: false },
      ringing: { type: Number, required: false },
      answered: { type: Number, required: false },
      final: { type: Number, required: false },
    },
    finalStatus: { type: String, required: false },
    disposition: { type: String, required: false },
    durationSec: { type: Number, required: false },
  },
  { _id: false }
);

const CapacityRunSchema = new Schema<ICapacityRunDocument>(
  {
    startedAt: {
      type: Date,
      default: Date.now,
      index: true,
      required: true,
    },
    numbers: {
      type: [String],
      required: true,
    },
    calls: {
      type: [CapacityCallSchema],
      required: true,
      default: [],
    },
    finishedAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

export const CapacityRun = model<ICapacityRunDocument>('CapacityRun', CapacityRunSchema);
