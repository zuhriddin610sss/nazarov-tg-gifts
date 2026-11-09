import { pathToFileURL } from 'node:url';
const shim = pathToFileURL(new URL('./sdk-shim.js', import.meta.url).pathname).href;
export async function resolve(spec, ctx, next) {
  if (spec === 'sdk' || spec.startsWith('sdk/')) return { url: shim, shortCircuit: true };
  return next(spec, ctx);
}
