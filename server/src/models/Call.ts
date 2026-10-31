import { Schema, model, Document } from 'mongoose';

export interface ICall {
  omixoCallId: string;
  to: string;
  message?: string;
  status: string;
  disposition?: string;
  durationSec?: number;
  cost?: number;
  answeredAt?: Date;
  completedAt?: Date;
  placedAt: Date;
  lastError?: string;
  source: 'obd' | 'click_to_call';
  agentNumber?: string;
  callerId?: string;
}

export interface ICallDocument extends ICall, Document {}

const CallSchema = new Schema<ICallDocument>(
  {
    omixoCallId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    to: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    message: {
      type: String,
      required: false,
    },
    status: {
      type: String,
      required: true,
      default: 'queued',
      index: true,
    },
    disposition: {
      type: String,
      required: false,
    },
    durationSec: {
      type: Number,
      required: false,
    },
    cost: {
      type: Number,
      required: false,
    },
    answeredAt: {
      type: Date,
      required: false,
    },
    completedAt: {
      type: Date,
      required: false,
    },
    placedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastError: {
      type: String,
      required: false,
    },
    source: {
      type: String,
      enum: ['obd', 'click_to_call'],
      default: 'obd',
      required: true,
    },
    agentNumber: {
      type: String,
      required: false,
      trim: true,
    },
    callerId: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Call = model<ICallDocument>('Call', CallSchema);
