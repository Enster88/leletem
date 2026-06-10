import { useState, useEffect } from 'react';
import { useUser, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import Head from 'next/head';

export default function Home() {
  const [tab, setTab] = useState('text');
  const [input, setInput] = useState('');
  const [state, setState] = useState('idle'); // idle | loading | results
  const [result, setResult] = useState(null);
  const [loadingText, setLoadingText] = useState('Elemezzük a leleted...');
  const [error, setError] = useState('');
  const { isSignedIn, user } = useUser();
  const [analyses, setAnalyses] = useState([]);
  const [usageInfo, setUsageInfo] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (isSignedIn) {
      fetch('/api/analyses')
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setAnalyses(data); });
      fetch('/api/usage')
        .then(r => r.json())
        .then(data => { if (data.limit) setUsageInfo(data); });
    }
  }, [isSignedIn]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success')) setError('');
    if (params.get('canceled')) setError('A fizetés megszakadt. Bármikor újra próbálhatod.');
  }, []);
  const [anonymousId] = useState(() => Math.random().toString(36).slice(2));

  const loadingMsgs = [
    'Elemezzük a leleted...',
    'Azonosítjuk az értékeket...',
    'Összehasonlítjuk a referenciákkal...',
    'Összeállítjuk a magyarázatot...'
  ];

  const [uploadedFile, setUploadedFile] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type === 'application/pdf') {
      setUploadedFile(file);
      setInput('');
    } else {
      setUploadedFile(null);
      const reader = new FileReader();
      reader.onload = (ev) => { setInput(ev.target.result); setTab('text'); };
      reader.readAsText(file);
    }
  };

  const analyze = async () => {
    if (!uploadedFile && (!input.trim() || input.trim().length < 15)) {
      setError('Kérlek illessz be lelet szöveget!');
      return;
    }
    setError('');
    setState('loading');

    let i = 0;
    const interval = setInterval(() => {
      i = Math.min(i + 1, loadingMsgs.length - 1);
      setLoadingText(loadingMsgs[i]);
    }, 2800);

    try {
      let body;
      if (uploadedFile && uploadedFile.type === 'application/pdf') {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(uploadedFile);
        });
        body = JSON.stringify({ pdfBase64: base64, anonymousId });
      } else {
        body = JSON.stringify({ text: input, anonymousId, email: user?.primaryEmailAddress?.emailAddress });
      }
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      const data = await res.json();
      if (data.error === 'limit_reached') {
        clearInterval(interval);
        setState('idle');
        setError(data.message);
        return;
      }
      if (data.error) throw new Error(data.error);
      clearInterval(interval);
      setResult(data);
      setState('results');
      // Frissítjük az előzményeket
      if (isSignedIn) {
        fetch('/api/analyses')
          .then(r => r.json())
          .then(d => { if (Array.isArray(d)) setAnalyses(d); });
      }
    } catch (e) {
      clearInterval(interval);
      setError(e.message || 'Hiba történt, kérlek próbáld újra.');
      setState('idle');
    }
  };

  const reset = () => { setState('idle'); setInput(''); setResult(null); setError(''); };

  const goToPremium = async () => {
    if (!isSignedIn) { setError('Bejelentkezés szükséges a fizetéshez.'); return; }
    try {
      const res = await fetch('/api/checkout', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch (e) {
      setError('Hiba a fizetési oldal megnyitásakor.');
    }
  };

  const badgeLabel = { ok: 'Normális', figyelem: 'Figyelj rá', riaszto: 'Kérdezd meg orvosodat' };
  const badgeClass = { ok: 'badge-ok', figyelem: 'badge-warn', riaszto: 'badge-alert' };
  const cardClass = { ok: 'card-ok', figyelem: 'card-warn', riaszto: 'card-alert' };

  return (
    <>
      <Head>
        <title>Leletem.hu – Orvosi lelet értelmező magyarul</title>
        <meta name="description" content="Értsd meg az orvosi leletedet közérthető nyelven, magyarul. Labor eredmény értelmező – tudd meg mit jelentenek az értékeid és mikor fordulj orvoshoz." />
        <meta name="keywords" content="orvosi lelet értelmező, labor eredmény magyarázat, vérkép értelmezés, magyar lelet értelmező, laborlelet mit jelent" />
        <meta property="og:title" content="Leletem.hu – Orvosi lelet értelmező magyarul" />
        <meta property="og:description" content="Értsd meg az orvosi leletedet közérthető nyelven. Labor eredmény értelmező magyarul – 30 másodperc alatt." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://leletem.vercel.app" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="Leletem.hu – Orvosi lelet értelmező" />
        <meta name="twitter:description" content="Értsd meg az orvosi leletedet közérthető nyelven, magyarul." />
        <link rel="canonical" href="https://leletem.vercel.app" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --teal: #1B5E6E; --teal-light: #E8F4F7; --teal-mid: #4A9BAD;
          --green: #4CAF7D; --green-light: #E8F7EF;
          --warm: #F8F6F2; --text: #1A1A1A; --muted: #6B7280; --border: #E5E0D8;
        }
        body { font-family: 'Inter', sans-serif; background: var(--warm); color: var(--text); }
        a { color: var(--teal-mid); text-decoration: none; }
        nav { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 2rem; border-bottom: 1px solid var(--border); background: var(--warm); position: sticky; top: 0; z-index: 10; }
        .logo { font-family: 'Fraunces', serif; font-size: 22px; color: var(--teal); }
        .logo span { color: var(--green); }
        .nav-cta { background: var(--teal); color: #fff; border: none; padding: 9px 22px; border-radius: 20px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: 'Inter', sans-serif; }
        .nav-cta:hover { opacity: .9; }
        .hero { padding: 4rem 2rem 2.5rem; text-align: center; max-width: 640px; margin: 0 auto; }
        .eyebrow { font-size: 11px; font-weight: 500; letter-spacing: 2px; text-transform: uppercase; color: var(--teal-mid); margin-bottom: 1rem; }
        h1 { font-family: 'Fraunces', serif; font-size: 44px; line-height: 1.12; color: var(--teal); margin-bottom: 1rem; font-weight: 600; }
        h1 em { font-style: italic; color: var(--green); }
        .hero p { font-size: 16px; color: var(--muted); line-height: 1.75; margin-bottom: 2rem; max-width: 480px; margin-left: auto; margin-right: auto; }
        .trust-row { display: flex; justify-content: center; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 2.5rem; }
        .trust-item { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
        .trust-item i { color: var(--green); font-size: 15px; }
        .tool-wrap { max-width: 600px; margin: 0 auto 1rem; padding: 0 1rem; }
        .tool-card { background: #fff; border: 1px solid var(--border); border-radius: 16px; padding: 2rem; }
        .tabs { display: flex; gap: 4px; background: var(--warm); border-radius: 10px; padding: 4px; margin-bottom: 1.5rem; }
        .tab-btn { flex: 1; padding: 8px 10px; border: none; background: transparent; border-radius: 7px; font-size: 13px; font-weight: 500; color: var(--muted); cursor: pointer; transition: all .15s; font-family: 'Inter', sans-serif; }
        .tab-btn.active { background: #fff; color: var(--teal); box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .upload-area { border: 1.5px dashed var(--border); border-radius: 12px; padding: 2rem; text-align: center; cursor: pointer; position: relative; margin-bottom: 1rem; transition: background .15s; }
        .upload-area:hover { background: var(--teal-light); }
        .upload-area input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
        .upload-icon { font-size: 30px; color: var(--teal-mid); display: block; margin-bottom: .5rem; }
        .upload-area p { font-size: 14px; color: var(--muted); margin-bottom: .25rem; }
        .upload-area span { font-size: 12px; color: #9CA3AF; }
        textarea { width: 100%; height: 150px; resize: vertical; border: 1px solid var(--border); border-radius: 10px; padding: .875rem 1rem; font-size: 14px; font-family: 'Inter', sans-serif; color: var(--text); background: #fff; line-height: 1.65; transition: border-color .15s; }
        textarea:focus { outline: none; border-color: var(--teal-mid); }
        textarea::placeholder { color: #9CA3AF; }
        .analyze-btn { width: 100%; margin-top: 1rem; padding: .9rem; background: var(--teal); color: #fff; border: none; border-radius: 10px; font-size: 15px; font-weight: 500; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font-family: 'Inter', sans-serif; }
        .analyze-btn:hover { opacity: .88; }
        .analyze-btn:disabled { opacity: .4; cursor: not-allowed; }
        .disclaimer { font-size: 11px; color: #9CA3AF; text-align: center; margin-top: .75rem; line-height: 1.6; }
        .error-msg { font-size: 13px; color: #991B1B; background: #FEE2E2; border-radius: 8px; padding: .6rem 1rem; margin-top: .75rem; }
        .loading { text-align: center; padding: 2.5rem 0; }
        .dots { display: flex; justify-content: center; gap: 5px; margin-bottom: .875rem; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--teal-mid); animation: pulse 1.2s ease-in-out infinite; }
        .dot:nth-child(2) { animation-delay: .2s; }
        .dot:nth-child(3) { animation-delay: .4s; }
        @keyframes pulse { 0%, 100% { opacity: .25; transform: scale(.75); } 50% { opacity: 1; transform: scale(1); } }
        .loading p { font-size: 14px; color: var(--muted); }
        .result-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; }
        .result-top h2 { font-family: 'Fraunces', serif; font-size: 19px; color: var(--teal); }
        .reset-btn { font-size: 12px; color: var(--muted); background: none; border: 1px solid var(--border); border-radius: 20px; padding: 5px 14px; cursor: pointer; font-family: 'Inter', sans-serif; }
        .summary { background: var(--teal-light); border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 1.25rem; font-size: 14px; color: var(--teal); line-height: 1.75; }
        .findings { display: flex; flex-direction: column; gap: .75rem; }
        .finding { background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.25rem; border-left: 3px solid var(--border); }
        .card-ok { border-left-color: var(--green); }
        .card-warn { border-left-color: #F59E0B; }
        .card-alert { border-left-color: #EF4444; }
        .finding-top { display: flex; align-items: center; gap: 8px; margin-bottom: .4rem; }
        .badge { font-size: 11px; font-weight: 500; padding: 2px 10px; border-radius: 20px; }
        .badge-ok { background: var(--green-light); color: #15803D; }
        .badge-warn { background: #FEF3C7; color: #92400E; }
        .badge-alert { background: #FEE2E2; color: #991B1B; }
        .finding-name { font-size: 13px; font-weight: 500; color: var(--text); }
        .finding-body { font-size: 13px; color: var(--muted); line-height: 1.65; margin-bottom: .4rem; }
        .finding-action { font-size: 13px; color: var(--teal); font-weight: 500; display: flex; align-items: flex-start; gap: 5px; }
        .how { padding: 3.5rem 2rem; max-width: 580px; margin: 0 auto; }
        .how h2 { font-family: 'Fraunces', serif; font-size: 30px; color: var(--teal); margin-bottom: 2rem; text-align: center; }
        .steps { display: flex; flex-direction: column; gap: 1.25rem; }
        .step { display: flex; align-items: flex-start; gap: 1rem; }
        .step-num { width: 36px; height: 36px; min-width: 36px; border-radius: 50%; background: var(--teal); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; font-family: 'Fraunces', serif; }
        .step-text h4 { font-size: 15px; font-weight: 500; margin-bottom: .3rem; color: var(--text); }
        .step-text p { font-size: 14px; color: var(--muted); line-height: 1.65; }
        .pricing { padding: 3.5rem 2rem; background: #fff; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .pricing-inner { max-width: 500px; margin: 0 auto; text-align: center; }
        .pricing h2 { font-family: 'Fraunces', serif; font-size: 30px; color: var(--teal); margin-bottom: .5rem; }
        .pricing-sub { font-size: 15px; color: var(--muted); margin-bottom: 2rem; }
        .plans { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem; }
        .plan { border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; text-align: left; background: var(--warm); }
        .plan.featured { border: 2px solid var(--teal); background: #fff; }
        .plan-label { font-size: 11px; font-weight: 500; letter-spacing: 1.5px; text-transform: uppercase; color: var(--teal-mid); margin-bottom: .5rem; }
        .plan-price { font-family: 'Fraunces', serif; font-size: 34px; color: var(--teal); line-height: 1; margin-bottom: .25rem; }
        .plan-price sub { font-size: 14px; font-family: 'Inter', sans-serif; color: var(--muted); font-weight: 400; }
        .plan-desc { font-size: 13px; color: var(--muted); margin-bottom: 1rem; line-height: 1.5; }
        .plan-features { list-style: none; font-size: 13px; color: var(--muted); display: flex; flex-direction: column; gap: 7px; }
        .plan-features li { display: flex; align-items: center; gap: 7px; }
        .plan-features li i { color: var(--green); font-size: 14px; flex-shrink: 0; }
        .plan-note { font-size: 12px; color: #9CA3AF; }
        footer { padding: 2rem; text-align: center; font-size: 12px; color: #9CA3AF; border-top: 1px solid var(--border); }
        .questions-box { background: var(--warm); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.25rem; margin-top: 1.25rem; }
        .questions-box h4 { font-size: 14px; font-weight: 500; color: var(--teal); margin-bottom: .75rem; display: flex; align-items: center; gap: 6px; }
        .questions-list { list-style: none; display: flex; flex-direction: column; gap: .5rem; }
        .questions-list li { font-size: 13px; color: var(--muted); line-height: 1.6; display: flex; align-items: flex-start; gap: 8px; }
        .questions-list li::before { content: '?'; font-weight: 600; color: var(--teal-mid); flex-shrink: 0; margin-top: 1px; }
        .history-section { max-width: 600px; margin: 0 auto 3rem; padding: 0 1rem; }
        .history-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
        .history-header h3 { font-family: 'Fraunces', serif; font-size: 20px; color: var(--teal); }
        .history-toggle { font-size: 13px; color: var(--teal-mid); background: none; border: none; cursor: pointer; font-family: 'Inter', sans-serif; }
        .history-item { background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: .75rem; cursor: pointer; transition: border-color .15s; }
        .history-item:hover { border-color: var(--teal-mid); }
        .history-date { font-size: 11px; color: #9CA3AF; margin-bottom: .4rem; }
        .history-summary { font-size: 13px; color: var(--muted); line-height: 1.5; }
        .history-badges { display: flex; gap: 6px; margin-top: .5rem; flex-wrap: wrap; }
      `}</style>

      <nav>
        <div className="logo">leletem<span>.hu</span></div>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          {!isSignedIn ? (
            <>
              <SignInButton mode="modal">
                <button style={{background:'none',border:'1px solid var(--border)',borderRadius:'20px',padding:'8px 18px',fontSize:'13px',cursor:'pointer',fontFamily:'Inter,sans-serif',color:'var(--text)'}}>Bejelentkezés</button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="nav-cta">Regisztráció</button>
              </SignUpButton>
            </>
          ) : (
            <UserButton afterSignOutUrl="/" />
          )}
        </div>
      </nav>

      <section className="hero">
        <p className="eyebrow">Orvosi lelet értelmező</p>
        <h1>A leleted érthetően, <em>emberi nyelven</em> elmagyarázva</h1>
        <p>Töltsd fel a laboreredményedet, és elmondjuk közérthető nyelven mit jelent – mire érdemes figyelned, mi számít normálisnak, és mikor fordulj orvoshoz.</p>
        <div className="trust-row">
          <div className="trust-item"><i className="ti ti-shield-check" />&nbsp;Nem tárolunk adatot</div>
          <div className="trust-item"><i className="ti ti-language" />&nbsp;Magyar nyelven</div>
          <div className="trust-item"><i className="ti ti-clock" />&nbsp;30 másodperc alatt</div>
        </div>
      </section>

      <div className="tool-wrap" id="tool-section">
        <div className="tool-card">
          {state === 'idle' && (
            <>
              <div className="tabs">
                <button className={`tab-btn ${tab === 'text' ? 'active' : ''}`} onClick={() => setTab('text')}>
                  <i className="ti ti-text-size" /> Szöveg beillesztése
                </button>
                <button className={`tab-btn ${tab === 'file' ? 'active' : ''}`} onClick={() => setTab('file')}>
                  <i className="ti ti-upload" /> Fájl feltöltés
                </button>
              </div>

              {tab === 'text' && (
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={"Illeszd be a labor eredményed vagy a lelet szövegét...\n\nPl: Hemoglobin: 118 g/L (ref: 120-160)\nLeukocyta: 11.8 G/L (ref: 4.0-10.0)"}
                />
              )}

              {tab === 'file' && (
                <div className="upload-area" style={uploadedFile ? {background:'var(--teal-light)',borderColor:'var(--teal-mid)'} : {}}>
                  <input type="file" accept=".txt,.pdf" onChange={handleFile} />
                  <i className="ti ti-upload upload-icon" />
                  {uploadedFile ? <p style={{color:'var(--teal)',fontWeight:'500'}}>✓ {uploadedFile.name}</p> : <p>Húzd ide a fájlt, vagy kattints</p>}
                  <span>.txt és .pdf fájl támogatott – max. 10 MB</span>
                </div>
              )}

              {isSignedIn && usageInfo && (
                <div style={{fontSize:'12px',color:'var(--muted)',textAlign:'right',marginBottom:'.5rem'}}>
                  {usageInfo.used} / {usageInfo.limit} elemzés felhasználva ebben a hónapban
                </div>
              )}
              {!isSignedIn ? (
                <SignUpButton mode="modal">
                  <button className="analyze-btn">
                    <i className="ti ti-user-plus" />
                    Regisztrálj az elemzéshez – ingyenes
                  </button>
                </SignUpButton>
              ) : (
                <button className="analyze-btn" onClick={analyze}>
                  <i className="ti ti-stethoscope" />
                  Értelmezd a leletemet
                </button>
              )}
              {error && (
                <div className="error-msg" style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'8px'}}>
                  <span>{error}</span>
                  {error.includes('Válts') && (
                    <button onClick={goToPremium} style={{background:'var(--teal)',color:'#fff',border:'none',borderRadius:'8px',padding:'6px 14px',fontSize:'12px',fontWeight:'500',cursor:'pointer',whiteSpace:'nowrap',fontFamily:'Inter,sans-serif'}}>
                      Prémium – 990 Ft/hó
                    </button>
                  )}
                  {error.includes('Regisztrálj') && (
                    <SignUpButton mode="modal">
                      <button style={{background:'var(--teal)',color:'#fff',border:'none',borderRadius:'8px',padding:'6px 14px',fontSize:'12px',fontWeight:'500',cursor:'pointer',whiteSpace:'nowrap',fontFamily:'Inter,sans-serif'}}>
                        Ingyenes regisztráció
                      </button>
                    </SignUpButton>
                  )}
                </div>
              )}
              <p className="disclaimer">Ez az oldal nem helyettesíti az orvosi tanácsadást. Fontos döntések előtt mindig konzultálj kezelőorvosoddal.</p>
            </>
          )}

          {state === 'loading' && (
            <div className="loading">
              <div className="dots"><div className="dot" /><div className="dot" /><div className="dot" /></div>
              <p>{loadingText}</p>
            </div>
          )}

          {state === 'results' && result && (
            <>
              <div className="result-top">
                <h2>Eredmény</h2>
                <button className="reset-btn" onClick={reset}>← Új lelet</button>
              </div>
              <div className="summary">{result.osszefoglalas}</div>
              <div className="findings">
                {(result.leletek || []).map((f, idx) => (
                  <div key={idx} className={`finding ${cardClass[f.allapot] || 'card-ok'}`}>
                    <div className="finding-top">
                      <span className={`badge ${badgeClass[f.allapot] || 'badge-ok'}`}>{badgeLabel[f.allapot] || 'Normális'}</span>
                      <span className="finding-name">{f.nev}</span>
                    </div>
                    <div className="finding-body">{f.magyarazat}</div>
                    {f.teendo && (
                      <div className="finding-action">
                        <i className="ti ti-arrow-right" />
                        {f.teendo}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {result.kerdesek && result.kerdesek.length > 0 && (
                <div className="questions-box">
                  <h4><i className="ti ti-messages" /> Kérdések az orvosonak</h4>
                  <ul className="questions-list">
                    {result.kerdesek.map((k, i) => <li key={i}>{k}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <section className="how">
        <h2>Hogyan működik?</h2>
        <div className="steps">
          {[
            { n: 1, title: 'Feltöltöd a leletedet', desc: 'Beilleszted a szöveget vagy feltöltöd a fájlt. Semmit nem tárolunk – az adatod kizárólag az elemzés idejére kerül feldolgozásra.' },
            { n: 2, title: 'Megvizsgáljuk az értékeidet', desc: 'Minden értéket megvizsgálunk – mi számít normálisnak, mi tér el, és mennyire jelentős az eltérés a referenciaértékekhez képest.' },
            { n: 3, title: 'Közérthető magyarázatot kapsz', desc: 'Nem orvosi szakszavak – egyszerű, közérthető magyarázatot kapsz. Megtudod mit jelent minden érték, és mit érdemes tenned.' }
          ].map(s => (
            <div key={s.n} className="step">
              <div className="step-num">{s.n}</div>
              <div className="step-text"><h4>{s.title}</h4><p>{s.desc}</p></div>
            </div>
          ))}
        </div>
      </section>

      {isSignedIn && analyses.length > 0 && (
        <div className="history-section">
          <div className="history-header">
            <h3>Korábbi elemzéseim</h3>
            <button className="history-toggle" onClick={() => setShowHistory(!showHistory)}>
              {showHistory ? 'Elrejtés' : `Megjelenítés (${analyses.length})`}
            </button>
          </div>
          {showHistory && analyses.map(a => (
            <div key={a.id} className="history-item" onClick={() => { setResult({osszefoglalas: a.osszefoglalas, leletek: a.leletek}); setState('results'); window.scrollTo({top: 0, behavior: 'smooth'}); }}>
              <div className="history-date">{new Date(a.created_at).toLocaleDateString('hu-HU', {year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
              <div className="history-summary">{a.osszefoglalas}</div>
              <div className="history-badges">
                {(a.leletek || []).filter(l => l.allapot === 'riaszto').length > 0 && <span className="badge badge-alert">{a.leletek.filter(l => l.allapot === 'riaszto').length} figyelmeztető</span>}
                {(a.leletek || []).filter(l => l.allapot === 'figyelem').length > 0 && <span className="badge badge-warn">{a.leletek.filter(l => l.allapot === 'figyelem').length} figyelj rá</span>}
                {(a.leletek || []).filter(l => l.allapot === 'ok').length > 0 && <span className="badge badge-ok">{a.leletek.filter(l => l.allapot === 'ok').length} normális</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="pricing">
        <div className="pricing-inner">
          <h2>Egyszerű árazás</h2>
          <p className="pricing-sub">Próbáld ki ingyen, fizess csak ha hasznos</p>
          <div className="plans">
            <div className="plan">
              <div className="plan-label">Ingyenes</div>
              <div className="plan-price">0 Ft</div>
              <div className="plan-desc">Ismerkedj meg kockázat nélkül</div>
              <ul className="plan-features">
                <li><i className="ti ti-check" />1 elemzés / hónap</li>
                <li><i className="ti ti-check" />Szöveges lelet</li>
                <li><i className="ti ti-check" />Magyar magyarázat</li>
              </ul>
            </div>
            <div className="plan featured">
              <div className="plan-label">Prémium</div>
              <div className="plan-price">990 Ft<sub> / hó</sub></div>
              <div className="plan-desc">Korlátlan elemzés, minden funkcióval</div>
              <ul className="plan-features">
                <li><i className="ti ti-check" />Korlátlan elemzés</li>
                <li><i className="ti ti-check" />PDF és kép feltöltés</li>
                <li><i className="ti ti-check" />Részletes magyarázat</li>
                <li><i className="ti ti-check" />Kérdések az orvosnak</li>
              </ul>
              <button onClick={goToPremium} style={{width:'100%',marginTop:'1rem',padding:'10px',background:'var(--teal)',color:'#fff',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'500',cursor:'pointer',fontFamily:'Inter,sans-serif'}}>
                Előfizetés indítása
              </button>
            </div>
          </div>
          <p className="plan-note">Bankkártyás fizetés · Bármikor lemondható · Nincs rejtett díj</p>
        </div>
      </section>

      <footer>
        <p>© 2025 leletem.hu &nbsp;·&nbsp; <a href="#">Adatvédelem</a> &nbsp;·&nbsp; <a href="#">ÁSZF</a> &nbsp;·&nbsp; Nem orvosi tanácsadás</p>
      </footer>
    </>
  );
}
