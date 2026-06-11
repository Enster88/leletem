import { supabase } from '../../lib/supabase';
import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

  if (secret) {
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(rawBody).digest('hex');
    const sig = req.headers['x-signature'];
    if (sig !== digest) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventName = event.meta?.event_name;
  const userId = event.meta?.custom_data?.user_id;
  const subscriptionId = event.data?.id;

  console.log('LS Webhook:', eventName, 'userId:', userId);

  if (eventName === 'order_created' || eventName === 'subscription_created') {
    if (userId) {
      await supabase.from('users').upsert({
        id: userId,
        is_premium: true,
        stripe_subscription_id: subscriptionId,
      }, { onConflict: 'id' });
    }
  }

  if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
    if (userId) {
      await supabase.from('users')
        .update({ is_premium: false })
        .eq('id', userId);
    }
  }

  res.status(200).json({ received: true });
}
