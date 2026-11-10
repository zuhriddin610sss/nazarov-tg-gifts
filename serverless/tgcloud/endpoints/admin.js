// Admin panel: Telegram.WebApp.Serverless.call('admin', { action, ...params }). Faqat ADMIN_IDS.
import { EndpointError } from 'sdk';
import { ensureSchema, isAdmin, logError } from 'lib/core';
import { actions } from 'lib/admin';

export default async function (input, ctx) {
  const user = ctx.initData && ctx.initData.user;
  if (!user || !isAdmin(user.id)) throw new EndpointError('FORBIDDEN', { code: 'FORBIDDEN' });
  await ensureSchema();
  const fn = Object.prototype.hasOwnProperty.call(actions, input.action) ? actions[input.action] : null;
  if (!fn) throw new EndpointError('UNKNOWN_ACTION', { code: 'UNKNOWN_ACTION' });
  try {
    return await fn(input, `admin:${user.id}`);
  } catch (e) {
    if (e instanceof EndpointError) throw e;
    await logError('admin.' + input.action, e && (e.stack || e.message || e.description));
    throw new EndpointError('INTERNAL', { code: 'INTERNAL' });
  }
}
