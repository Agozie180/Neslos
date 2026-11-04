import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScheduleStore } from '../src/owner/scheduler.js';
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'neslos-schedule-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const input = () => ({ format: 'neslos-schedule-v1', id: randomUUID(), configHash: 'ab'.repeat(32), command: { type: 'observe', id: randomUUID(), authorizationHash: 'cd'.repeat(32) }, intervalSeconds: 300, maxRuns: 2, runs: 0, state: 'active', nextRunAt: new Date(0).toISOString() });
it('persists an interrupted attempt and resumes its exact ID after restart', async () => {
  const run = vi.fn().mockRejectedValue(new Error('INFERENCE_OUTCOME_UNKNOWN'));
  const store = new ScheduleStore(directory, run), schedule = await store.create(input());
  const failed = (await store.tick())!;
  expect(failed.state).toBe('paused'); expect(failed.runs).toBe(1); expect(failed.pendingJobId).toBeTruthy();
  await store.tick(); expect(run).toHaveBeenCalledTimes(1);
  const recoveredRun = vi.fn().mockResolvedValue({ stop: false }), restarted = new ScheduleStore(directory, recoveredRun);
  await restarted.control(schedule.id, 'active'); const result = (await restarted.tick())!;
  expect(recoveredRun.mock.calls[0]![0].id).toBe(run.mock.calls[0]![0].id);
  expect(result.runs).toBe(1); expect(result.lastJobId).toBe(failed.pendingJobId); expect(result.pendingJobId).toBeUndefined();
});
it('does not backfill missed intervals and stops at the finite attempt count', async () => {
  const run = vi.fn().mockResolvedValue({ stop: false }), store = new ScheduleStore(directory, run);
  const schedule = await store.create(input()); const first = (await store.tick())!;
  await store.tick(); expect(run).toHaveBeenCalledTimes(1);
  await store.tick(new Date(Date.parse(first.nextRunAt) + 10000000));
  expect((await store.get(schedule.id)).state).toBe('complete');
  await store.tick(new Date('2100-01-01')); expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[0]![0].id).not.toBe(run.mock.calls[1]![0].id);
});
it('stops on a terminal settlement and refuses payment preparation or unlimited schedules', async () => {
  const run = vi.fn().mockResolvedValue({ stop: true }), store = new ScheduleStore(directory, run);
  await store.create(input()); expect((await store.tick())!.state).toBe('complete');
  await expect(store.create({ ...input(), maxRuns: 13 })).rejects.toThrow();
  await expect(store.create({ ...input(), command: { type: 'status', id: randomUUID() } })).rejects.toThrow();
  expect(run).toHaveBeenCalledTimes(1);
});
