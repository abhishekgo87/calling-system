import mongoose from 'mongoose';
import { Call, ICall } from '../models/Call';

// In-memory fallback storage when local MongoDB server is not running
const inMemoryCalls: ICall[] = [];

export interface CreateCallParams {
  omixoCallId: string;
  to: string;
  message?: string;
  status: string;
  source?: 'obd' | 'click_to_call';
  placedAt?: Date;
  agentNumber?: string;
  callerId?: string;
}

export interface UpdateCallParams {
  status: string;
  disposition?: string;
  durationSec?: number;
  cost?: number;
  answeredAt?: Date;
  completedAt?: Date;
}

export const callService = {
  /**
   * Save a newly placed call
   */
  async createCall(params: CreateCallParams): Promise<ICall> {
    const data: ICall = {
      omixoCallId: params.omixoCallId,
      to: params.to,
      message: params.message,
      status: params.status,
      source: params.source || 'obd',
      placedAt: params.placedAt || new Date(),
      agentNumber: params.agentNumber,
      callerId: params.callerId,
    };

    if (mongoose.connection.readyState === 1) {
      const doc = await Call.create(data);
      return doc.toObject() as ICall;
    }

    // In-memory fallback
    inMemoryCalls.unshift(data);
    return data;
  },

  /**
   * List saved calls, newest first
   */
  async listCalls(limit = 50): Promise<ICall[]> {
    if (mongoose.connection.readyState === 1) {
      const docs = await Call.find().sort({ placedAt: -1 }).limit(limit).lean().exec();
      return docs as unknown as ICall[];
    }

    // In-memory fallback
    return inMemoryCalls
      .slice()
      .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())
      .slice(0, limit);
  },

  /**
   * Update a call by omixoCallId and return the updated record
   */
  async updateCall(omixoCallId: string, updates: UpdateCallParams): Promise<ICall | null> {
    if (mongoose.connection.readyState === 1) {
      const doc = await Call.findOneAndUpdate(
        { omixoCallId },
        { $set: updates },
        { new: true }
      ).lean().exec();
      return (doc as unknown as ICall) || null;
    }

    // In-memory fallback
    const item = inMemoryCalls.find((c) => c.omixoCallId === omixoCallId);
    if (!item) {
      return null;
    }

    item.status = updates.status;
    if (updates.disposition !== undefined) {
      item.disposition = updates.disposition;
    }
    if (updates.durationSec !== undefined) {
      item.durationSec = updates.durationSec;
    }
    if (updates.cost !== undefined) {
      item.cost = updates.cost;
    }
    if (updates.answeredAt !== undefined) {
      item.answeredAt = updates.answeredAt;
    }
    if (updates.completedAt !== undefined) {
      item.completedAt = updates.completedAt;
    }

    return item;
  },

  /**
   * Find a call by omixoCallId
   */
  async findByOmixoId(omixoCallId: string): Promise<ICall | null> {
    if (mongoose.connection.readyState === 1) {
      const doc = await Call.findOne({ omixoCallId }).lean().exec();
      return (doc as unknown as ICall) || null;
    }

    const item = inMemoryCalls.find((c) => c.omixoCallId === omixoCallId);
    return item || null;
  },
};
