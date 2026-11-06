// wander-api.js - the Netlify version of the function that keeps your keys on the host.
// All the work is in server/wander-core.mjs (shared with the Vercel version in api/wander.mjs).
import { handle } from '../../server/wander-core.mjs';

export default function handler(req) {
  return handle(req, (name) => { try { return Netlify.env.get(name); } catch (e) { return ''; } });
}

export const config = { path: '/api/*' };
