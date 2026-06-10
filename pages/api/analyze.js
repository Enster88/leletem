import Anthropic from '@anthropic-ai/sdk';
import { getAuth } from '@clerk/nextjs/server';
import { supabase } from '../../lib/supabase';
import formidable from 'formidable';
import fs from 'fs';
import pdfParse from 'pdf-parse';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const config = { api: { bodyParser: false } };

function getMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}`;
}

async function parseRequest(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

async function extractText(fields, files) {
  // Ha szöveg jött
  if (fields.text && fields.text[0]?.trim().length > 0) {
    return fields.text[0];
  }

  // Ha PDF jött
  if (files.pdf) {
    const file = Array.isArray(files.pdf) ? files.pdf[0] : files.pdf;
    const buffer = fs.readFileSync(file.filepath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = getAuth(req);
  let fields, files;

  try {
    ({ fields, files } = await parseRequest(req));
  } catch (e) {
    return res.status(400).json({ error: 'Fájl feldolgozási hiba.' });
  }

  const anonymousId = fields.anonymousId?.[0];
  const text = await extractText(fields, files);

  if (!text || text.trim().length < 15) {
    return res.status(400).json({ error: 'Túl rövid a szöveg vagy nem sikerült kiolvasni a PDF-et.' });
  }

  const monthKey = getMonthKey();

  if (userId) {
    let { data: user } = await supabase
      .from('users')
      .select('is_premium, usage_count, usage_month')
      .eq('id', userId)
      .single();

    if (!user) {
      await supabase.from('users').insert({
        id: userId,
        is_premium: false,
        usage_count: 0,
        usage_month: monthKey
      });
      user = { is_premium: false, usage_count: 0, usage_month: monthKey };
    }

    if (!user.is_premium) {
      const currentCount = user.usage_month === monthKey ? (user.usage_count || 0) : 0;
      if (currentCount >= 1) {
        return res.status(403).json({
          error: 'limit_reached',
          message: 'Elérted az ingyenes havi limitet. Válts Prémiumra a korlátlan elemzésért.'
        });
      }
    }

    const result = await runAnalysis(text);
    if (result.error) return res.status(500).json(result);

    if (!user.is_premium) {
      const newCount = user.usage_month === monthKey ? (user.usage_count || 0) + 1 : 1;
      await supabase.from('users')
        .update({ usage_count: newCount, usage_month: monthKey })
        .eq('id', userId);
    }

    return res.status(200).json(result);

  } else {
    const anonKey = `anon_${anonymousId}_${monthKey}`;
    let { data: anonUser } = await supabase
      .from('users')
      .select('usage_count, usage_month')
      .eq('id', anonKey)
      .single();

    if (anonUser && anonUser.usage_count >= 1) {
      return res.status(403).json({
        error: 'limit_reached',
        message: 'Regisztrálj ingyenesen a további elemzésekhez.'
      });
    }

    const result = await runAnalysis(text);
    if (result.error) return res.status(500).json(result);

    await supabase.from('users').upsert({
      id: anonKey,
      usage_count: 1,
      usage_month: monthKey
    }, { onConflict: 'id' });

    return res.status(200).json(result);
  }
}

async function runAnalysis(text) {
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
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
      "magyarazat": "Mit jelent közérthetően",
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
    return JSON.parse(raw);
  } catch (e) {
    console.error(e);
    return { error: 'Elemzési hiba. Kérlek próbáld újra.' };
  }
}
