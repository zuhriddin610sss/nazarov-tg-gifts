// Mahalliy test uchun `sdk` o'rnini bosuvchi: SQLite (node:sqlite), Bot API yozuvchisi, fetch soxtasi.
import { DatabaseSync } from 'node:sqlite';

export class EndpointError extends Error {
  constructor(description, parameters = {}) { super(description); this.description = description; this.parameters = parameters; }
}
export class BotApiError extends Error {}
export class InputFile { constructor(bytes, name, opts = {}) { this.bytes = bytes; this.name = name; this.type = opts.type; } }

let sqlite = new DatabaseSync(':memory:');
export function resetDb() { sqlite = new DatabaseSync(':memory:'); }
const prep = (q) => sqlite.prepare(typeof q === 'string' ? q : q.text);
export const db = {
  async run(q, p = {}) {
    const st = prep(q);
    if (/\bRETURNING\b/i.test(q)) { const rows = st.all(p); return { rowsAffected: rows.length, lastInsertRowid: 0, rows }; }
    const r = st.run(p);
    return { rowsAffected: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid), rows: [] };
  },
  async all(q, p = {}) { return prep(q).all(p); },
  async get(q, p = {}) { return prep(q).get(p) ?? null; },
  async values(q, p = {}) { return prep(q).all(p).map((r) => Object.values(r)); },
};
export default db;

export const sent = [];
let fileN = 0;
export const api = new Proxy({}, {
  get: (_t, method) => async (params) => {
    sent.push({ method, params });
    if (method === 'sendPhoto') return { message_id: sent.length, photo: [{ file_id: 'small' }, { file_id: typeof params.photo === 'string' ? params.photo : 'FILE' + (++fileN) }] };
    if (method === 'getFileContent') return new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    return { message_id: sent.length };
  },
});

export let fetchMock = async () => { throw new Error('fetch not mocked'); };
export function setFetch(fn) { fetchMock = fn; }
export const fetch = (...a) => fetchMock(...a);
