import Anthropic from '@anthropic-ai/sdk';
import { getAuth } from '@clerk/nextjs/server';
import { supabase } from '../../lib/supabase';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = getAuth(req);
  const { text, anonymousId, pdfBase64 } = req.body;

  let finalText = text;

  // Ha PDF jött base64-ben, küldjük el Claudenak közvetlenül
  if (pdfBase64 && !text) {
    finalText = '__PDF__';
  }

  if (!finalText || finalText.trim().length < 5) {
    return res.status(400).json({ error: 'Kérlek illessz be szöveget vagy tölts fel fájlt.' });
  }

  const monthKey = getMonthKey();

  if (userId) {
    let { data: user } = await supabase
      .from('users')
      .select('is_premium, usage_count, usage_month')
      .eq('id', userId)
      .single();

    if (!user) {
      const { email } = req.body;
      await supabase.from('users').insert({
        id: userId, is_premium: false, usage_count: 0, usage_month: monthKey, email: email || null
      });
      user = { is_premium: false, usage_count: 0, usage_month: monthKey };
    }

    const currentCount = user.usage_month === monthKey ? (user.usage_count || 0) : 0;
    const limit = user.is_premium ? 30 : 1;
    if (currentCount >= limit) {
      return res.status(403).json({
        error: 'limit_reached',
        message: user.is_premium
          ? 'Elérted a havi 30 elemzés limitet. Legközelebb jövő hónapban érhető el újra.'
          : 'Elérted az ingyenes havi limitet. Válts Prémiumra a korlátlan elemzésért.'
      });
    }

    const result = await runAnalysis(text, pdfBase64);
    if (result.error) return res.status(500).json(result);

    const newCount = user.usage_month === monthKey ? (user.usage_count || 0) + 1 : 1;
    await supabase.from('users').update({ usage_count: newCount, usage_month: monthKey }).eq('id', userId);

    // Mentjük az elemzést és küldünk emailt
    if (userId && !result.error) {
      await supabase.from('analyses').insert({
        user_id: userId,
        osszefoglalas: result.osszefoglalas,
        leletek: result.leletek
      });
    }

    return res.status(200).json(result);

  } else {
    const anonKey = `anon_${anonymousId}_${monthKey}`;
    let { data: anonUser } = await supabase
      .from('users').select('usage_count').eq('id', anonKey).single();

    if (anonUser && anonUser.usage_count >= 1) {
      return res.status(403).json({
        error: 'limit_reached',
        message: 'Regisztrálj ingyenesen a további elemzésekhez.'
      });
    }

    const result = await runAnalysis(text, pdfBase64);
    if (result.error) return res.status(500).json(result);

    await supabase.from('users').upsert({
      id: anonKey, usage_count: 1, usage_month: monthKey
    }, { onConflict: 'id' });

    return res.status(200).json(result);
  }
}

async function runAnalysis(text, pdfBase64) {
  try {
    let messages;

    if (pdfBase64) {
      messages = [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
          },
          {
            type: 'text',
            text: `Te egy magyar orvosi lelet értelmező vagy. Elemezd a csatolt PDF leletet és válaszolj KIZÁRÓLAG valid JSON-ban, semmi más szöveg nélkül.

Struktúra:
{
  "osszefoglalas": "2-3 mondatos közérthető összefoglaló",
  "leletek": [
    {
      "allapot": "ok" | "figyelem" | "riaszto",
      "nev": "paraméter neve",
      "magyarazat": "Mit jelent közérthetően",
      "teendo": "Mit érdemes tenni"
    }
  ],
  "kerdesek": ["Konkrét kérdés az orvosnak", "Másik kérdés", "Harmadik kérdés"]
}

3-7 leletet adj vissza. A kerdesek mezőbe 3-4 konkrét, hasznos kérdést írj amit a páciens feltehet az orvosának. Mindent magyarul írj.`
          }
        ]
      }];
    } else {
      messages = [{
        role: 'user',
        content: `Te egy magyar orvosi lelet értelmező vagy. Elemezd az alábbi leletet és válaszolj KIZÁRÓLAG valid JSON-ban, semmi más szöveg nélkül.

Struktúra:
{
  "osszefoglalas": "2-3 mondatos közérthető összefoglaló",
  "leletek": [
    {
      "allapot": "ok" | "figyelem" | "riaszto",
      "nev": "paraméter neve",
      "magyarazat": "Mit jelent közérthetően",
      "teendo": "Mit érdemes tenni"
    }
  ],
  "kerdesek": ["Konkrét kérdés az orvosnak", "Másik kérdés", "Harmadik kérdés"]
}

3-7 leletet adj vissza. A kerdesek mezőbe 3-4 konkrét, hasznos kérdést írj amit a páciens feltehet az orvosának az eredmények alapján. Mindent magyarul írj.

Lelet:
${text.substring(0, 5000)}`
      }];
    }

    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      messages
    });

    const raw = message.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch (e) {
    console.error(e);
    return { error: 'Elemzési hiba. Kérlek próbáld újra.' };
  }
}
