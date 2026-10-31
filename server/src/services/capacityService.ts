import mongoose from 'mongoose';
import { CapacityRun, ICapacityRun, ICapacityCall } from '../models/CapacityRun';

export interface CapacityRunItem extends ICapacityRun {
  id: string;
}

// In-memory fallback storage when local MongoDB server is not running
const inMemoryRuns: CapacityRunItem[] = [];

export interface CreateCapacityRunParams {
  startedAt: Date;
  numbers: string[];
  calls: ICapacityCall[];
}

export interface UpdateCapacityRunParams {
  calls?: ICapacityCall[];
  finishedAt?: Date;
}

export const capacityService = {
  /**
   * Save a newly started capacity test run
   */
  async createRun(params: CreateCapacityRunParams): Promise<CapacityRunItem> {
    const data: ICapacityRun = {
      startedAt: params.startedAt,
      numbers: params.numbers,
      calls: params.calls,
    };

    if (mongoose.connection.readyState === 1) {
      const doc = await CapacityRun.create(data);
      const obj = doc.toObject() as unknown as CapacityRunItem;
      obj.id = String(doc._id);
      return obj;
    }

    // In-memory fallback
    const memId = `mem_run_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const memRun: CapacityRunItem = {
      ...data,
      id: memId,
    };
    inMemoryRuns.unshift(memRun);
    return memRun;
  },

  /**
   * Get a capacity test run by id
   */
  async getRun(id: string): Promise<CapacityRunItem | null> {
    if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(id)) {
      const doc = await CapacityRun.findById(id).lean().exec();
      if (!doc) return null;
      const res = doc as unknown as CapacityRunItem;
      res.id = String(doc._id);
      return res;
    }

    const item = inMemoryRuns.find((r) => r.id === id);
    return item ? { ...item } : null;
  },

  /**
   * Update calls or finishedAt on an active run
   */
  async updateRun(id: string, updates: UpdateCapacityRunParams): Promise<CapacityRunItem | null> {
    if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(id)) {
      const doc = await CapacityRun.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true }
      ).lean().exec();
      if (!doc) return null;
      const res = doc as unknown as CapacityRunItem;
      res.id = String(doc._id);
      return res;
    }

    const item = inMemoryRuns.find((r) => r.id === id);
    if (!item) return null;

    if (updates.calls) {
      item.calls = updates.calls;
    }
    if (updates.finishedAt) {
      item.finishedAt = updates.finishedAt;
    }

    return { ...item };
  },

  /**
   * List recent capacity runs (default last 10)
   */
  async listRuns(limit = 10): Promise<CapacityRunItem[]> {
    if (mongoose.connection.readyState === 1) {
      const docs = await CapacityRun.find().sort({ startedAt: -1 }).limit(limit).lean().exec();
      return docs.map((doc) => {
        const item = doc as unknown as CapacityRunItem;
        item.id = String(doc._id);
        return item;
      });
    }

    return inMemoryRuns
      .slice()
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  },

  /**
   * Get the single most recent run to enforce cooldown & single-run concurrency
   */
  async getLastRun(): Promise<CapacityRunItem | null> {
    if (mongoose.connection.readyState === 1) {
      const doc = await CapacityRun.findOne().sort({ startedAt: -1 }).lean().exec();
      if (!doc) return null;
      const res = doc as unknown as CapacityRunItem;
      res.id = String(doc._id);
      return res;
    }

    if (inMemoryRuns.length === 0) return null;
    return inMemoryRuns[0] ? { ...inMemoryRuns[0] } : null;
  },
};
