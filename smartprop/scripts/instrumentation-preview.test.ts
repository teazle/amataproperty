import { afterEach, expect, spyOn, test } from 'bun:test';
import { registerNodeInstrumentation } from '../src/instrumentation-node';

const prior = process.env.SMARTPROP_BACKGROUND_SERVICES_ENABLED;
afterEach(() => {
  if (prior === undefined) delete process.env.SMARTPROP_BACKGROUND_SERVICES_ENABLED;
  else process.env.SMARTPROP_BACKGROUND_SERVICES_ENABLED = prior;
});

test('an explicitly isolated preview schedules no scraper or LinkedIn background work', async () => {
  process.env.SMARTPROP_BACKGROUND_SERVICES_ENABLED = 'false';
  const timer = spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as never);
  try {
    await registerNodeInstrumentation();
    expect(timer).not.toHaveBeenCalled();
  } finally { timer.mockRestore(); }
});

test('normal startup still schedules both existing background services', async () => {
  delete process.env.SMARTPROP_BACKGROUND_SERVICES_ENABLED;
  const timer = spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as never);
  try {
    await registerNodeInstrumentation();
    expect(timer.mock.calls.map(call => call[1])).toEqual([10000, 12000]);
  } finally { timer.mockRestore(); }
});
