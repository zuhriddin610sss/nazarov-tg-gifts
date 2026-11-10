// Mijoz Mini App'i: Telegram.WebApp.Serverless.call('app', { action, ...params })
import { EndpointError } from 'sdk';
import { ensureSchema, logError } from 'lib/core';
import { actions, upsertCustomer } from 'lib/customer';
import { maybeRunJobs } from 'lib/jobs';

export default async function (input, ctx) {
  const user = ctx.initData && ctx.initData.user;
  if (!user || !Number.isSafeInteger(user.id)) throw new EndpointError('UNAUTHORIZED', { code: 'UNAUTHORIZED' });
  await ensureSchema();
  const fn = Object.prototype.hasOwnProperty.call(actions, input.action) ? actions[input.action] : null;
  if (!fn) throw new EndpointError('UNKNOWN_ACTION', { code: 'UNKNOWN_ACTION' });
  const customer = await upsertCustomer(user);
  try {
    return await fn(input, customer);
  } catch (e) {
    if (e instanceof EndpointError) throw e;
    await logError('app.' + input.action, e && (e.stack || e.message || e.description));
    throw new EndpointError('INTERNAL', { code: 'INTERNAL' });
  } finally {
    await maybeRunJobs();
  }
}
