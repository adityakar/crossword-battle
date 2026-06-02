/* ============================================================
   builder.jsx — organizer's "Create Puzzle" flow
   Manual word+clue entry OR AI generation from a topic.
   Both feed the auto-layout generator → live grid preview.
   ============================================================ */
const { useState: useStateB } = React;

function MiniPreview({ result }) {
  if (!result) return null;
  const pz = result.puzzle;
  const cell = Math.max(16, Math.min(34, Math.floor(300 / Math.max(pz.rows, pz.cols))));
  return (
    <div>
      <div style={{display:'flex', justifyContent:'center', padding:'4px 0 14px'}}>
        <Crossword puzzle={pz} reveal interactive={false} cellSize={cell} />
      </div>
      <div className="label" style={{textAlign:'center'}}>
        {pz.rows}×{pz.cols} · {pz.across.length + pz.down.length} WORDS · {pz.cellCount} CELLS
      </div>
      {result.dropped.length>0 && (
        <div className="well" style={{marginTop:12, padding:'11px 14px'}}>
          <div className="label" style={{color:'var(--coral-ink)'}}>COULDN'T INTERLOCK</div>
          <div className="body" style={{fontSize:12, marginTop:5}}>{result.dropped.join(', ')} — these don't share letters with the rest. Tweak or swap them.</div>
        </div>
      )}
    </div>
  );
}

// ---- one word/clue row ----
function WordRow({ idx, row, count, onChange, onRemove, onMove }) {
  const chev = (dir, disabled) => (
    <button onClick={()=>!disabled && onMove(idx, dir)} disabled={disabled} aria-label={dir<0?'move up':'move down'}
      style={{width:24, height:20, borderRadius:5, border:'1px solid var(--line-2)', background:'transparent',
        color: disabled?'var(--line-3)':'var(--grey)', cursor: disabled?'default':'pointer', padding:0,
        display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, lineHeight:1}}>
      {dir<0?'▲':'▼'}
    </button>
  );
  return (
    <div style={{display:'flex', gap:7, alignItems:'flex-start'}}>
      <div style={{display:'flex', flexDirection:'column', gap:2, flexShrink:0, paddingTop:1}}>
        {chev(-1, idx===0)}
        {chev(1, idx===count-1)}
      </div>
      <input value={row.answer} onChange={e=>onChange(idx,'answer',e.target.value.toUpperCase().replace(/[^A-Z]/g,''))}
        placeholder="WORD" maxLength={9}
        style={{width:82, flexShrink:0, fontFamily:'var(--mono)', fontWeight:600, fontSize:15, letterSpacing:'0.05em',
          color:'var(--ink)', background:'var(--paper)', border:'1.5px solid var(--line-2)', borderRadius:8, padding:'11px 10px', outline:'none'}} />
      <input value={row.clue} onChange={e=>onChange(idx,'clue',e.target.value)}
        placeholder="Clue for this word"
        style={{flex:1, minWidth:0, fontFamily:'var(--sans)', fontSize:14, color:'var(--ink)',
          background:'var(--paper)', border:'1.5px solid var(--line-2)', borderRadius:8, padding:'12px 12px', outline:'none'}} />
      <button onClick={()=>onRemove(idx)} aria-label="remove"
        style={{flexShrink:0, width:36, height:42, borderRadius:8, border:'1px solid var(--line-2)',
          background:'transparent', color:'var(--grey-soft)', cursor:'pointer', fontSize:18}}>×</button>
    </div>
  );
}

function OrgBuilder() {
  const { dispatch } = useGame();
  const [mode, setMode] = useStateB('manual');     // manual | ai
  const [name, setName] = useStateB('');
  const [rows, setRows] = useStateB([
    { answer:'', clue:'' }, { answer:'', clue:'' }, { answer:'', clue:'' }, { answer:'', clue:'' },
  ]);
  const [topic, setTopic] = useStateB('');
  const [count, setCount] = useStateB(6);
  const [loading, setLoading] = useStateB(false);
  const [error, setError] = useStateB(null);
  const [result, setResult] = useStateB(null);

  const setRow = (i,k,v) => setRows(rs => rs.map((r,j)=>j===i?{...r,[k]:v}:r));
  const addRow = () => setRows(rs => [...rs, {answer:'',clue:''}]);
  const removeRow = (i) => setRows(rs => rs.length>1 ? rs.filter((_,j)=>j!==i) : rs);
  const moveRow = (i, delta) => setRows(rs => {
    const j = i+delta; if (j<0||j>=rs.length) return rs;
    const next = rs.slice(); [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  const validRows = rows.filter(r => r.answer.trim().length>=2 && r.clue.trim());

  const build = (entries, meta) => {
    const res = generatePuzzle(entries, { ...meta, seed: Math.floor(Math.random()*1e6) });
    if (!res) { setError('Need at least 2 words that share letters.'); setResult(null); return; }
    setError(null); setResult(res);
  };

  const buildManual = () => {
    if (validRows.length < 2) { setError('Add at least 2 words, each with a clue.'); return; }
    build(validRows, { name: name.trim() || 'Custom Puzzle', tag:'Custom' });
  };

  const generateAI = async () => {
    if (!topic.trim()) { setError('Describe a topic or theme first.'); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const prompt = `You are building a tiny crossword for a live event game. Topic / theme: "${topic.trim()}".
Produce exactly ${count} entries that interlock well (favor common letters like A, E, R, S, T, O, N).
Each entry has:
- "answer": ONE word, UPPERCASE, letters only, 3 to 7 letters, no spaces or punctuation
- "clue": a short, clever clue (max 9 words). Never include the answer in its own clue.
Return ONLY a raw JSON array, no prose, no code fences. Example:
[{"answer":"MODEL","clue":"What you train on data"},{"answer":"AGENT","clue":"Autonomous AI doer"}]`;
      const raw = await window.claude.complete(prompt);
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('no-json');
      const arr = JSON.parse(match[0]);
      const entries = arr
        .map(e => ({ answer:(e.answer||'').toUpperCase().replace(/[^A-Z]/g,''), clue:(e.clue||'').trim() }))
        .filter(e => e.answer.length>=2 && e.answer.length<=9 && e.clue);
      if (entries.length < 2) throw new Error('too-few');
      setRows(entries);
      setName(topic.trim().replace(/\b\w/g, c=>c.toUpperCase()).slice(0,28));
      build(entries, { name: topic.trim().slice(0,28) || 'AI Puzzle', tag:'AI-generated', topic: topic.trim() });
      setMode('manual'); // reveal the generated words for editing
    } catch (e) {
      setError('AI generation hit a snag — try a more concrete topic, or add words manually.');
    } finally {
      setLoading(false);
    }
  };

  const useIt = () => {
    if (!result) return;
    dispatch({ type:'ADD_PUZZLE', puzzle: result.puzzle });
    dispatch({ type:'GOTO', phase:'setup' });
  };

  const tab = (id, label) => (
    <button onClick={()=>{setMode(id); setError(null);}} style={{
      flex:1, padding:'11px', borderRadius:9, cursor:'pointer', fontFamily:'var(--head)', fontWeight:600, fontSize:14,
      border:'1.5px solid '+(mode===id?'var(--ink)':'var(--line)'),
      background: mode===id?'var(--ink)':'transparent', color: mode===id?'var(--cream)':'var(--grey)'}}>
      {label}
    </button>
  );

  return (
    <Screen footer={
      <div className="stack" style={{'--gap':'10px'}}>
        <Btn kind="coral" disabled={!result} onClick={useIt}>
          {result ? 'Use This Puzzle →' : 'Build a grid to continue'}
        </Btn>
        <Btn kind="ghost" onClick={()=>dispatch({type:'GOTO',phase:'setup'})}>Cancel</Btn>
      </div>
    }>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 22px 14px', borderBottom:'1px solid var(--line)'}}>
        <Wordmark />
        <Chip kind="coral-soft"><Spark size={10}/>NEW PUZZLE</Chip>
      </div>

      <div className="pad" style={{paddingTop:20}}>
        <div className="label">PUZZLE BUILDER</div>
        <div className="h1" style={{fontSize:30, marginTop:8}}>Make a crossword</div>
        <p className="body" style={{fontSize:14, marginTop:10}}>
          Add your own words & clues, or let AI draft them from a topic. The grid sizes itself around whatever interlocks.
        </p>
      </div>

      {/* mode tabs */}
      <div className="pad" style={{marginTop:18}}>
        <div style={{display:'flex', gap:8}}>{tab('manual','Manual')}{tab('ai','AI assist')}</div>
      </div>

      {mode==='ai' ? (
        <div className="pad" style={{marginTop:18}}>
          <div className="label" style={{marginBottom:8}}>TOPIC OR PROMPT</div>
          <textarea value={topic} onChange={e=>setTopic(e.target.value)} rows={3}
            placeholder={'e.g. ' + EVENT.topicHint}
            style={{width:'100%', fontFamily:'var(--sans)', fontSize:15, color:'var(--ink)', background:'var(--paper)',
              border:'1.5px solid var(--line-2)', borderRadius:12, padding:'14px', outline:'none', resize:'vertical', lineHeight:1.4}} />
          <div className="kv" style={{marginTop:16, alignItems:'center'}}>
            <span className="label">HOW MANY WORDS</span>
            <Stepper value={count} set={setCount} min={4} max={10} step={1} />
          </div>
          <div style={{marginTop:18}}>
            <Btn kind="dark" disabled={loading} onClick={generateAI}>
              {loading ? 'Drafting with AI…' : <span style={{display:'inline-flex',alignItems:'center',gap:8}}><Spark color="var(--cream)"/> Generate with AI</span>}
            </Btn>
          </div>
          <div className="body" style={{fontSize:12, marginTop:10, color:'var(--grey-soft)'}}>
            AI drafts words + clues, then you can edit them in the Manual tab before building.
          </div>
        </div>
      ) : (
        <div className="pad" style={{marginTop:18}}>
          <div className="kv" style={{marginBottom:10}}>
            <span className="label">WORDS & CLUES</span>
            <span className="label">{validRows.length} READY</span>
          </div>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Puzzle name (optional)"
            style={{width:'100%', marginBottom:12, fontFamily:'var(--head)', fontWeight:600, fontSize:15, color:'var(--ink)',
              background:'var(--paper)', border:'1.5px solid var(--line-2)', borderRadius:8, padding:'12px', outline:'none'}} />
          <div className="stack" style={{'--gap':'8px'}}>
            {rows.map((row,i)=>(
              <WordRow key={i} idx={i} row={row} count={rows.length} onChange={setRow} onRemove={removeRow} onMove={moveRow} />
            ))}
          </div>
          <button onClick={addRow} className="btn btn-ghost btn-sm" style={{width:'100%', marginTop:10}}>+ Add word</button>
        </div>
      )}

      {/* build button */}
      <div className="pad" style={{marginTop:18}}>
        <Btn kind={mode==='ai'?'ghost':'coral'} onClick={buildManual} disabled={validRows.length<2}>
          {result ? 'Rebuild grid' : 'Build grid'} ({validRows.length} words)
        </Btn>
        {error && <div className="body" style={{fontSize:13, marginTop:10, color:'var(--coral-ink)'}}>{error}</div>}
      </div>

      {/* preview */}
      {result && (
        <div className="pad" style={{marginTop:22}}>
          <div className="label" style={{marginBottom:10}}>PREVIEW · {(name||'Custom Puzzle').toUpperCase()}</div>
          <div className="card" style={{padding:'16px'}}>
            <MiniPreview result={result} />
          </div>
        </div>
      )}
    </Screen>
  );
}

Object.assign(window, { OrgBuilder });
