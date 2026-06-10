import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
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

    if (!user.is_premium) {
      const currentCount = user.usage_month === monthKey ? (user.usage_count || 0) : 0;
      if (currentCount >= 1) {
        return res.status(403).json({
          error: 'limit_reached',
          message: 'Elérted az ingyenes havi limitet. Válts Prémiumra a korlátlan elemzésért.'
        });
      }
    }

    const result = await runAnalysis(text, pdfBase64);
    if (result.error) return res.status(500).json(result);

    if (!user.is_premium) {
      const newCount = user.usage_month === monthKey ? (user.usage_count || 0) + 1 : 1;
      await supabase.from('users').update({ usage_count: newCount, usage_month: monthKey }).eq('id', userId);
    }

    // Mentjük az elemzést és küldünk emailt
    if (userId && !result.error) {
      await supabase.from('analyses').insert({
        user_id: userId,
        osszefoglalas: result.osszefoglalas,
        leletek: result.leletek
      });

      // Email küldése
      try {
        const { data: userData } = await supabase
          .from('users')
          .select('email')
          .eq('id', userId)
          .single();

        if (userData?.email) {
          const findingRows = (result.leletek || []).map(f => {
            const color = f.allapot === 'riaszto' ? '#991B1B' : f.allapot === 'figyelem' ? '#92400E' : '#15803D';
            const bg = f.allapot === 'riaszto' ? '#FEE2E2' : f.allapot === 'figyelem' ? '#FEF3C7' : '#E8F7EF';
            const label = f.allapot === 'riaszto' ? 'Kérdezd meg orvosodat' : f.allapot === 'figyelem' ? 'Figyelj rá' : 'Normális';
            return `<tr><td style="padding:10px;border-bottom:1px solid #E5E0D8;"><span style="background:${bg};color:${color};font-size:11px;padding:2px 8px;border-radius:20px;font-weight:500;">${label}</span> <strong>${f.nev}</strong><br><span style="font-size:13px;color:#6B7280;">${f.magyarazat}</span>${f.teendo ? `<br><span style="font-size:13px;color:#1B5E6E;font-weight:500;">→ ${f.teendo}</span>` : ''}</td></tr>`;
          }).join('');

          const questionRows = (result.kerdesek || []).map(k =>
            `<li style="margin-bottom:6px;font-size:13px;color:#6B7280;">${k}</li>`
          ).join('');

          console.log('Sending email to:', userData.email);
          const emailResult = await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: userData.email,
            subject: 'A lelet elemzésed eredménye',
            html: `
              <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:2rem;">
                <h1 style="font-family:Georgia,serif;color:#1B5E6E;font-size:28px;margin-bottom:.5rem;">leletem.hu</h1>
                <p style="color:#6B7280;font-size:14px;margin-bottom:2rem;">Az elemzésed eredménye</p>
                <div style="background:#E8F4F7;border-radius:10px;padding:1rem 1.25rem;margin-bottom:1.5rem;font-size:14px;color:#1B5E6E;line-height:1.7;">
                  ${result.osszefoglalas}
                </div>
                <table style="width:100%;border-collapse:collapse;margin-bottom:1.5rem;">
                  ${findingRows}
                </table>
                ${result.kerdesek?.length ? `
                <div style="background:#F8F6F2;border-radius:10px;padding:1rem 1.25rem;">
                  <h4 style="font-size:14px;color:#1B5E6E;margin-bottom:.75rem;">Kérdések az orvosodnak</h4>
                  <ul style="padding-left:1rem;">${questionRows}</ul>
                </div>` : ''}
                <p style="font-size:11px;color:#9CA3AF;margin-top:2rem;text-align:center;">Ez az oldal nem helyettesíti az orvosi tanácsadást. Fontos döntések előtt mindig konzultálj kezelőorvosoddal.</p>
              </div>
            `
          });
          console.log('Email result:', JSON.stringify(emailResult));
        }
      } catch(emailErr) {
        console.error('Email hiba:', emailErr);
      }
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
