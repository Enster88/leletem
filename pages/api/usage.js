import { getAuth } from '@clerk/nextjs/server';
import { supabase } from '../../lib/supabase';

function getMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Bejelentkezés szükséges.' });

  const { data: user } = await supabase
    .from('users')
    .select('is_premium, usage_count, usage_month')
    .eq('id', userId)
    .single();

  const monthKey = getMonthKey();
  const used = user?.usage_month === monthKey ? (user?.usage_count || 0) : 0;
  const limit = user?.is_premium ? 30 : 1;

  res.status(200).json({
    used,
    limit,
    is_premium: user?.is_premium || false,
    remaining: Math.max(0, limit - used)
  });
}
