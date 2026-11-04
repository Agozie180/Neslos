import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { commandSchema, type PrivateCommand } from '../core/private-protocol.js';
import { hashHex } from '../core/wire.js';
import { writePrivateJson } from './account.js';

const uuid = z.string().uuid();
export const scheduleSchema = z.object({
  format: z.literal('neslos-schedule-v1'), id: uuid, configHash: hashHex,
  command: commandSchema.refine(c => c.type === 'research' || c.type === 'observe', 'Only research and settlement observation can be scheduled.'),
  intervalSeconds: z.number().int().min(300).max(604800), maxRuns: z.number().int().min(1).max(12),
  runs: z.number().int().min(0).max(12), nextRunAt: z.iso.datetime(),
  state: z.enum(['active', 'paused', 'complete']), pendingJobId: uuid.optional(), lastJobId: uuid.optional(), errorCode: z.string().max(80).optional(),
}).strict();
export type PrivateSchedule = z.infer<typeof scheduleSchema>;

/** The owner server serializes this store with manual actions. No relaying or payment submission. */
export class ScheduleStore {
  private directory: string;
  constructor(directory: string, private run: (command: PrivateCommand, configHash: string) => Promise<{ stop: boolean }>) { this.directory = resolve(directory); }
  private path(id: string) { return join(this.directory, uuid.parse(id) + '.json'); }
  async get(id: string) { return scheduleSchema.parse(JSON.parse(await readFile(this.path(id), 'utf8'))); }
  async list() {
    let names: string[];
    try { names = await readdir(this.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const files = names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
    if (files.length > 100) throw new Error('SCHEDULE_CAPACITY');
    const records = await Promise.all(files.map(name => this.get(name.slice(0, -5))));
    return records.sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
  }
  async create(input: unknown) {
    const schedule = scheduleSchema.parse(input);
    if (schedule.runs !== 0 || schedule.pendingJobId || schedule.lastJobId || schedule.state !== 'active') throw new Error('SCHEDULE_INITIAL_STATE');
    if ((await this.list()).length >= 100) throw new Error('SCHEDULE_CAPACITY');
    await writePrivateJson(this.path(schedule.id), schedule, true); return schedule;
  }
  async control(id: string, state: 'active' | 'paused') {
    const schedule = await this.get(id);
    if (schedule.state === 'complete') throw new Error('SCHEDULE_COMPLETE');
    schedule.state = state; delete schedule.errorCode;
    await writePrivateJson(this.path(id), schedule); return schedule;
  }
  async tick(now = new Date()) {
    // At most one due occurrence per tick. Missed time is never backfilled.
    const schedule = (await this.list()).find(s => s.state === 'active' && Date.parse(s.nextRunAt) <= now.getTime());
    if (!schedule) return;
    if (!schedule.pendingJobId) {
      if (schedule.runs >= schedule.maxRuns) { schedule.state = 'complete'; await writePrivateJson(this.path(schedule.id), schedule); return; }
      schedule.pendingJobId = randomUUID(); schedule.runs++;
      await writePrivateJson(this.path(schedule.id), schedule); // Save the exact ID before any network work.
    }
    const id = schedule.pendingJobId;
    try {
      const result = await this.run({ ...schedule.command, id }, schedule.configHash);
      schedule.lastJobId = id; delete schedule.pendingJobId; delete schedule.errorCode;
      schedule.nextRunAt = new Date(Math.max(now.getTime(), Date.now()) + schedule.intervalSeconds * 1000).toISOString();
      if (result.stop || schedule.runs >= schedule.maxRuns) schedule.state = 'complete';
    } catch (error) {
      // Preserve unknown attempts and require inspection before resuming the same job.
      schedule.state = 'paused'; schedule.errorCode = /^[A-Z][A-Z0-9_]+/.exec(error instanceof Error ? error.message : '')?.[0] ?? 'SCHEDULE_ATTEMPT_FAILED';
    }
    await writePrivateJson(this.path(schedule.id), schedule); return schedule;
  }
}
