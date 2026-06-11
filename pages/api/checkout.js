import { getAuth } from '@clerk/nextjs/server';
import { lemonSqueezySetup, createCheckout } from '@lemonsqueezy/lemonsqueezy.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, sessionClaims } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Bejelentkezés szükséges.' });

  lemonSqueezySetup({ apiKey: process.env.LEMONSQUEEZY_API_KEY });

  try {
    const email = sessionClaims?.email || '';

    const checkout = await createCheckout(
      process.env.LEMONSQUEEZY_STORE_ID,
      process.env.LEMONSQUEEZY_VARIANT_ID,
      {
        checkoutOptions: {
          embed: false,
          media: false,
        },
        checkoutData: {
          email,
          custom: { user_id: userId },
        },
        productOptions: {
          redirectUrl: `${req.headers.origin}/?success=true`,
          receiptButtonText: 'Vissza az oldalra',
          receiptThankYouNote: 'Köszönjük az előfizetést! Korlátlan elemzés vár rád.',
        },
      }
    );

    res.status(200).json({ url: checkout.data?.data?.attributes?.url });
  } catch (e) {
    console.error('LS checkout error:', e);
    res.status(500).json({ error: 'Hiba a fizetési oldal létrehozásakor.' });
  }
}
