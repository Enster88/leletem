import { getAuth } from '@clerk/nextjs/server';
import { lemonSqueezySetup, createCheckout } from '@lemonsqueezy/lemonsqueezy.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Bejelentkezés szükséges.' });

  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  const variantId = process.env.LEMONSQUEEZY_VARIANT_ID;
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;

  console.log('Store ID:', storeId);
  console.log('Variant ID:', variantId);
  console.log('API Key exists:', !!apiKey);

  lemonSqueezySetup({ apiKey });

  try {
    const checkout = await createCheckout(storeId, variantId, {
      checkoutData: {
        custom: { user_id: userId },
      },
      productOptions: {
        redirectUrl: `${req.headers.origin}/?success=true`,
      },
    });

    console.log('Checkout response:', JSON.stringify(checkout));

    const url = checkout.data?.data?.attributes?.url;
    console.log('URL:', url);

    res.status(200).json({ url });
  } catch (e) {
    console.error('LS checkout error:', e.message, e.cause);
    res.status(500).json({ error: e.message });
  }
}
