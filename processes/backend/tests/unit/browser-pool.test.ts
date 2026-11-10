import { describe, it, expect } from 'vitest';
import { Semaphore } from '../../src/automation/async.js';
import { WorkflowRegistry } from '../../src/automation/WorkflowRegistry.js';
describe('browser pool admission', () => {
  it('bounds concurrent leases, grants FIFO, and releases idempotently', async () => {
    const pool = new Semaphore(1);
    const signal = new AbortController().signal;
    const release = await pool.acquire(signal, 1000);
    const order: number[] = [];
    const second = pool.acquire(signal, 1000).then((r) => {
      order.push(2);
      return r;
    });
    const third = pool.acquire(signal, 1000).then((r) => {
      order.push(3);
      return r;
    });
    expect(pool.status).toMatchObject({ active: 1, waiting: 2 });
    release();
    release();
    const release2 = await second;
    expect(order).toEqual([2]);
    release2();
    (await third)();
    expect(order).toEqual([2, 3]);
    expect(pool.status.active).toBe(0);
  });
  it('removes aborted and expired waiters without leaking capacity', async () => {
    const pool = new Semaphore(1);
    const release = await pool.acquire(new AbortController().signal, 100);
    const controller = new AbortController();
    const wait = pool.acquire(controller.signal, 100);
    const assertion = expect(wait).rejects.toMatchObject({ code: 'EXECUTION_ABORTED' });
    controller.abort();
    await assertion;
    await expect(pool.acquire(controller.signal, 100)).rejects.toMatchObject({
      code: 'EXECUTION_ABORTED',
    });
    await expect(pool.acquire(new AbortController().signal, 10)).rejects.toMatchObject({
      code: 'BROWSER_POOL_TIMEOUT',
    });
    release();
    expect(pool.status).toMatchObject({ active: 0, waiting: 0 });
  });
  it('rejects queued and future leases after shutdown', async () => {
    const pool = new Semaphore(1);
    const signal = new AbortController().signal;
    const release = await pool.acquire(signal, 100);
    const wait = pool.acquire(signal, 100);
    const assertion = expect(wait).rejects.toMatchObject({ code: 'BROWSER_POOL_CLOSED' });
    pool.close();
    await assertion;
    release();
    await expect(pool.acquire(signal, 100)).rejects.toMatchObject({ code: 'BROWSER_POOL_CLOSED' });
    expect(pool.status.active).toBe(0);
  });
  it('fails closed for unregistered workflows', () => {
    expect(() => new WorkflowRegistry().get('create-account')).toThrowError(
      'No approved browser workflow adapter',
    );
  });
});
