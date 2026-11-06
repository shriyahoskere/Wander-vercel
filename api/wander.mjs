// wander.mjs - the Vercel function that keeps your keys on Vercel. All the work is in
// server/wander-core.mjs (shared with the Netlify version).
import { handle } from '../server/wander-core.mjs';

export const config = { maxDuration: 120 };

export default {
  fetch(request) { return handle(request, (name) => process.env[name]); }
};
