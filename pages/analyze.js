import Anthropic from '@anthropic-ai/sdk';
import { getAuth } from '@clerk/nextjs/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory store a demo limithez
// Éles verzióban ez adatbázis lesz (pl. Planetscale / Supabase)
const usageStore = {};

function getMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = getAuth(req);
  const { text, anonymousId } = req.body;

  if (!text || text.trim().length < 15) {
    return res.status(400).json({ error: 'Túl rövid a szöveg.' });
  }

  // Limit ellenőrzés
  const trackingId = userId || `anon_${anonymousId}`;
  const monthKey = getMonthKey();
  const storeKey = `${trackingId}_${monthKey}`;

  if (!usageStore[storeKey]) usageStore[storeKey] = 0;

  // Bejelentkezett user: 1/hó ingyen, fizetős: korlátlan
  // Nem bejelentkezett: 1 próba összesen
  const limit = userId ? 1 : 1;

  if (usageStore[storeKey] >= limit) {
    return res.status(403).json({
      error: 'limit_reached',
      message: userId
        ? 'Elérted az ingyenes havi limitet. Váltj Prémiumra a korlátlan elemzésért.'
        : 'Regisztrálj ingyenesen a további elemzésekhez.'
    });
  }

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Te egy magyar orvosi lelet értelmező vagy. Elemezd az alábbi leletet és válaszolj KIZÁRÓLAG valid JSON-ban, semmi más szöveg nélkül.

Struktúra:
{
  "osszefoglalas": "2-3 mondatos közérthető összefoglaló",
  "leletek": [
    {
      "allapot": "ok" | "figyelem" | "riaszto",
      "nev": "paraméter neve",
      "magyarazat": "Mit jelent plain language-en",
      "teendo": "Mit érdemes tenni"
    }
  ]
}

3-7 leletet adj vissza. Mindent magyarul írj.

Lelet:
${text.substring(0, 5000)}`
      }]
    });

    const raw = message.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
    const result = JSON.parse(raw);

    // Sikeres elemzés után növeljük a számlálót
    usageStore[storeKey]++;

    res.status(200).json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Elemzési hiba. Kérlek próbáld újra.' });
  }
}
