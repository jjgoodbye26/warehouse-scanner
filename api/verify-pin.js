/**
 * POST /api/verify-pin
 * Validates the supervisor PIN without any side effects.
 * Returns 200 on success, 403 on failure.
 */
import bcrypt from 'bcryptjs';

const SUPERVISOR_PIN_HASH = process.env.SUPERVISOR_PIN_HASH;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'pin required' });
  if (!SUPERVISOR_PIN_HASH) return res.status(500).json({ error: 'PIN not configured' });

  const valid = await bcrypt.compare(pin, SUPERVISOR_PIN_HASH);
  if (!valid) return res.status(403).json({ error: 'Invalid PIN' });

  return res.status(200).json({ ok: true });
}
