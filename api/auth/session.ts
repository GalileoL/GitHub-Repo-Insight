import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSessionUser } from '../../lib/rag/auth/index.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = getSessionUser(req);
  if (!user) {
    return res.status(200).json({ authenticated: false, user: null });
  }

  return res.status(200).json({ authenticated: true, user });
}
