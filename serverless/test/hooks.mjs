import { pathToFileURL } from 'node:url';
const shim = pathToFileURL(new URL('./sdk-shim.js', import.meta.url).pathname).href;
const libDir = new URL('../tgcloud/lib/', import.meta.url);
export async function resolve(spec, ctx, next) {
  if (spec === 'sdk' || spec.startsWith('sdk/')) return { url: shim, shortCircuit: true };
  // Telegram Serverless modul nomlari: 'lib/core' -> tgcloud/lib/core.js
  if (/^lib\/[a-z0-9_]+$/.test(spec)) return { url: new URL(spec.slice(4) + '.js', libDir).href, shortCircuit: true };
  return next(spec, ctx);
}
