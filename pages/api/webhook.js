import Stripe from 'stripe';
import { supabase } from '../../lib/supabase';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
  console.log('WEBHOOK HIT - method:', req.method);
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).json({ error: `Webhook error: ${e.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    console.log('WEBHOOK checkout.session.completed - userId:', userId, '| metadata:', JSON.stringify(session.metadata));
    const customerId = session.customer;
    const subscriptionId = session.subscription;

    if (userId) {
      await supabase.from('users').upsert({
        id: userId,
        is_premium: true,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
      }, { onConflict: 'id' });
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    await supabase
      .from('users')
      .update({ is_premium: false, stripe_subscription_id: null })
      .eq('stripe_subscription_id', subscription.id);
  }

  res.status(200).json({ received: true });
}
