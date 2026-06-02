/* ============================================================
   player.jsx — the phone experience for a floor visitor
   ============================================================ */
const { useState, useEffect, useRef } = React;

// helpers --------------------------------------------------
// current word + its position in the across/down list, given the active puzzle
function currentClue(pz, sel) {
  const w = pWordAt(pz, sel.r, sel.c, sel.dir);
  if (!w) { const f = pz.across[0]; return { ...f, list:pz.across, idx:0 }; }
  const list = w.dir==='across' ? pz.across : pz.down;
  return { ...w, list, idx:list.indexOf(w) };
}
function hintText(word) {
  const n = word.answer.length;
  const base = word.clue ? word.clue : 'Think about the letters you already have';
  return `${n} letters. ${base}.`.replace(/\.\.$/,'.');
}

// ---------------- JOIN ----------------
function PlayerJoin({ locked=false }) {
  const { state, dispatch } = useGame();
  const [name, setName] = useState('');
  const joined = state.players.filter(p=>p.joined).length;
  if (locked) {
    return (
      <Screen>
        <div className="pad" style={{paddingTop:40, textAlign:'center'}}>
          <Wordmark /><div style={{height:30}}/>
          <div className="h1" style={{fontSize:30, marginTop:20}}>Round in progress</div>
          <p className="body" style={{marginTop:12}}>This organizer locked late joins. Hang tight — the next round opens in a moment.</p>
        </div>
      </Screen>
    );
  }
  return (
    <Screen footer={
      <Btn kind="coral" disabled={!name.trim()} onClick={()=>{ dispatch({type:'YOU_JOIN', name:name.trim()}); }}>
        Join the Sprint →
      </Btn>
    }>
      <div className="pad" style={{paddingTop:16}}><Wordmark /></div>
      <div className="pad" style={{paddingTop:30}}>
        <Chip kind="coral-soft" style={{marginBottom:18}}><Spark size={10}/>A 2-MINUTE AI CROSSWORD CHALLENGE</Chip>
        <div className="display" style={{fontSize:46}}>Beat the<br/>floor<span className="coral">.</span></div>
        <p className="body" style={{fontSize:15, marginTop:16, maxWidth:290}}>
          Tiny grid. Live clock. Fastest correct solve wins the round. AI hints if you're stuck — but they cost you.
        </p>
      </div>
      <div className="pad" style={{marginTop:30}}>
        <div className="label" style={{marginBottom:9}}>YOUR NAME</div>
        <input className="field" placeholder="Type your name" value={name}
          onChange={e=>setName(e.target.value)} maxLength={18}
          onKeyDown={e=>{ if(e.key==='Enter'&&name.trim()) dispatch({type:'YOU_JOIN', name:name.trim()}); }} />
        <div className="label" style={{marginTop:14, display:'flex', justifyContent:'space-between'}}>
          <span>CODE · {state.joinCode}</span>
          <span>{joined} ALREADY IN</span>
        </div>
      </div>
    </Screen>
  );
}

// ---------------- WAITING ----------------
function PlayerWaiting() {
  const { state } = useGame();
  const joined = state.players.filter(p=>p.joined).length;
  return (
    <Screen>
      <div className="pad" style={{paddingTop:16}}><Wordmark /></div>
      <div style={{display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', padding:'56px 22px 0'}}>
        <Avatar name={state.you?.name} coral size={68} />
        <div className="h1" style={{fontSize:30, marginTop:20}}>You're in, {state.you?.name?.split(' ')[0]}</div>
        <div className="label" style={{marginTop:10}}>CODE · {state.joinCode}</div>

        {/* anticipation pulser */}
        <div style={{margin:'40px 0 36px', position:'relative', width:120, height:120, display:'flex', alignItems:'center', justifyContent:'center'}}>
          <span style={{position:'absolute', inset:0, borderRadius:100, border:'2px solid var(--coral)', animation:'ripple 2s ease-out infinite'}}/>
          <span style={{position:'absolute', inset:0, borderRadius:100, border:'2px solid var(--coral)', animation:'ripple 2s ease-out infinite 1s'}}/>
          <Mark size={40}/>
        </div>

        <Chip kind="coral-soft" pulse>WAITING FOR ORGANIZER</Chip>
      </div>
      <div className="pad" style={{marginTop:40}}>
        <div className="card" style={{padding:'16px 18px'}}>
          <div className="kv"><span className="label">SESSION</span><span className="h3" style={{fontSize:15}}>{state.config.puzzleName}</span></div>
          <hr className="hr" style={{margin:'13px 0'}}/>
          <div className="kv"><span className="label">PLAYERS IN LOBBY</span><span className="h2 tnum coral" style={{fontSize:20}}>{joined}</span></div>
          <hr className="hr" style={{margin:'13px 0'}}/>
          <div className="kv"><span className="label">CLOCK</span><span className="h3 tnum" style={{fontSize:15}}>{fmtTime(state.config.durationSec)}</span></div>
        </div>
      </div>
      <style>{`@keyframes ripple{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.4);opacity:0}}`}</style>
    </Screen>
  );
}

// ---------------- COUNTDOWN MIRROR ----------------
function PlayerCountdown() {
  const { state } = useGame();
  return (
    <div className="screen-scroll" style={{background:'var(--ink)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'var(--cream)'}}>
      <div className="label" style={{color:'rgba(245,242,234,0.55)'}}>STARTING IN</div>
      <div key={state.countdownFrom} className="count-num pop" style={{fontSize:200, color:'var(--coral)', margin:'10px 0'}}>{state.countdownFrom}</div>
      <div className="label" style={{color:'rgba(245,242,234,0.55)'}}>PENCILS UP, {state.you?.name?.split(' ')[0]?.toUpperCase()}</div>
    </div>
  );
}

// ---------------- GAME ----------------
function PlayerGame() {
  const { state, dispatch } = useGame();
  const pz = state.activePuzzle;
  const [hint, setHint] = useState(null);
  const [toast, setToast] = useState(null);
  const [flash, setFlash] = useState(null); // 'wrong' | 'right'
  const remaining = liveRemaining(state);
  const danger = remaining <= 20;
  const cl = currentClue(pz, state.sel);
  const filled = Object.keys(state.entries).filter(k=>state.entries[k]).length;
  const you = state.you;

  // physical keyboard support
  useEffect(() => {
    const h = (e) => {
      if (/^[a-zA-Z]$/.test(e.key)) { dispatch({type:'TYPE', letter:e.key.toUpperCase()}); }
      else if (e.key==='Backspace') { dispatch({type:'BACKSPACE'}); }
      else if (e.key.startsWith('Arrow')) {
        const {r,c}=state.sel; let nr=r,nc=c;
        if(e.key==='ArrowRight')nc=Math.min(pz.cols-1,c+1); if(e.key==='ArrowLeft')nc=Math.max(0,c-1);
        if(e.key==='ArrowDown')nr=Math.min(pz.rows-1,r+1); if(e.key==='ArrowUp')nr=Math.max(0,r-1);
        if(!pIsBlock(pz,nr,nc)) dispatch({type:'SELECT',r:nr,c:nc});
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [state.sel, pz]);

  // auto-finish on full correct
  useEffect(() => {
    if (pProgress(pz, state.entries) === 1 && you && you.finishMs==null) {
      setFlash('right');
      const t = setTimeout(()=>dispatch({type:'YOU_FINISH'}), 700);
      return ()=>clearTimeout(t);
    }
  }, [state.entries]);

  const doHint = () => {
    // first empty cell in the current word
    const target = cl.cells.find(([r,c])=>!state.entries[`${r},${c}`]);
    if (!target) { setToast('That word is already full — try another.'); setTimeout(()=>setToast(null),1800); return; }
    dispatch({type:'USE_HINT', r:target[0], c:target[1]});
    setHint({ text: hintText(cl), penalty: state.config.hintPenalty, remaining: 'UNLIMITED' });
  };

  const doSubmit = () => {
    if (pProgress(pz, state.entries) === 1) return; // handled by effect
    if (filled >= pz.cellCount) {
      dispatch({type:'WRONG'}); setFlash('wrong'); setTimeout(()=>setFlash(null),500);
      setToast(`Not quite — +${state.config.wrongPenalty}s. Check the highlighted word.`); setTimeout(()=>setToast(null),2200);
    } else {
      setToast(`${pz.cellCount-filled} cells to go. Keep going.`); setTimeout(()=>setToast(null),1800);
    }
  };

  const navClue = (delta) => {
    const list = cl.list; const ni = (cl.idx + delta + list.length) % list.length;
    const target = list[ni];
    dispatch({type:'SELECT', r:target.cells[0][0], c:target.cells[0][1]});
    dispatch({type:'SET_DIR', dir:target.dir});
  };

  return (
    <React.Fragment>
      <div className="screen-scroll" style={{display:'flex', flexDirection:'column', paddingBottom:0}}>
        {/* top status */}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 20px 12px', borderBottom:'1px solid var(--line)'}}>
          <div>
            <div className="label" style={{fontSize:9}}>TIME LEFT</div>
            <div className={'h1 tnum'+(danger?' coral':'')} style={{fontSize:30}}>{fmtTime(remaining)}</div>
          </div>
          <div style={{textAlign:'center'}}>
            <div className="label" style={{fontSize:9}}>SOLVED</div>
            <div className="h2 tnum" style={{fontSize:20, marginTop:3}}>{Math.round((you?.progress||0)*100)}<span className="label">%</span></div>
          </div>
          <button onClick={doHint} className="btn btn-sm" style={{width:'auto', background:'var(--coral-tint)', color:'var(--coral-ink)', boxShadow:'inset 0 0 0 1px var(--coral-line)'}}>
            <Spark size={13}/> Hint
          </button>
        </div>

        {/* grid */}
        <div style={{display:'flex', justifyContent:'center', padding:'20px 0 6px',
          ...(flash==='wrong'?{animation:'shake .4s'}:{}), ...(flash==='right'?{animation:'pulseGrid .6s'}:{})}}>
          <Crossword puzzle={pz} entries={state.entries} sel={state.sel}
            cellSize={Math.min(56, Math.floor(312/Math.max(pz.cols, pz.rows)))}
            onSelect={(r,c)=>dispatch({type:'SELECT',r,c})} />
        </div>

        {/* progress dots */}
        <div className="pad" style={{display:'flex', justifyContent:'center', flexWrap:'wrap', gap:5, padding:'8px 22px 14px'}}>
          {pz.fill.map(([r,c],i)=>{
            const e=state.entries[`${r},${c}`];
            return <span key={i} style={{width:6,height:6,borderRadius:2,background:e?'var(--coral)':'var(--line-2)'}}/>;
          })}
        </div>

        {/* current clue + nav */}
        <div className="pad" style={{paddingBottom:14}}>
          <ClueCard clue={cl.clue} dir={cl.dir} num={cl.num} index={cl.idx+1} total={cl.list.length}
            onPrev={()=>navClue(-1)} onNext={()=>navClue(1)} />
          {/* across/down toggle */}
          <div style={{display:'flex', gap:8, marginTop:10}}>
            {['across','down'].map(d=>(
              <button key={d} onClick={()=>dispatch({type:'SET_DIR',dir:d})}
                style={{flex:1, padding:'9px', borderRadius:8, cursor:'pointer',
                  fontFamily:'var(--mono)', fontSize:11, letterSpacing:'0.1em', fontWeight:500,
                  border:'1px solid '+(state.sel.dir===d?'var(--ink)':'var(--line-2)'),
                  background: state.sel.dir===d?'var(--ink)':'transparent', color: state.sel.dir===d?'var(--cream)':'var(--grey)'}}>
                {d.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {hint && <div className="pad" style={{paddingBottom:14}}><HintCard {...hint} /></div>}
      </div>

      {/* toast */}
      {toast && (
        <div style={{position:'absolute', bottom:268, left:20, right:20, zIndex:30,
          background:'var(--ink)', color:'var(--cream)', padding:'12px 16px', borderRadius:10,
          fontSize:13, fontFamily:'var(--sans)', textAlign:'center'}} className="pop">{toast}</div>
      )}

      <LetterPad onKey={(l)=>dispatch({type:'TYPE',letter:l})} onBackspace={()=>dispatch({type:'BACKSPACE'})} onSubmit={doSubmit} />
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
      @keyframes pulseGrid{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}`}</style>
    </React.Fragment>
  );
}

// ---------------- COMPLETION ----------------
function PlayerCompletion() {
  const { state } = useGame();
  const you = state.you;
  const sc = scoreFor(you, state.config);
  const demo = recommendDemo(you);
  return (
    <Screen footer={<Btn kind="ghost" disabled>Waiting for final leaderboard…</Btn>}>
      <div className="pad" style={{paddingTop:16}}><Wordmark /></div>
      <div className="pad" style={{paddingTop:26}}>
        <div className="label rise" style={{color:'var(--coral)'}}>✓ SOLVED · PENCILS DOWN</div>
        <div className="display rise d1" style={{fontSize:46, marginTop:12}}>Nice solve,<br/>{you?.name?.split(' ')[0]}<span className="coral">.</span></div>
      </div>
      <div className="pad rise d2" style={{marginTop:24}}>
        <div className="card" style={{padding:'6px 18px'}}>
          <KV k="COMPLETION TIME" v={fmtTime(sc.raw)} vClass="coral" />
          <KV k="HINT PENALTY" v={`+${you.hintsUsed*state.config.hintPenalty}s`} sub={`${you.hintsUsed}×`} />
          <KV k="WRONG-ANSWER PENALTY" v={`+${you.wrongAttempts*state.config.wrongPenalty}s`} sub={`${you.wrongAttempts}×`} />
          <div className="kv" style={{padding:'18px 0'}}>
            <span className="label label-ink">ADJUSTED SCORE</span>
            <span className="h1 tnum" style={{fontSize:30}}>{sc.points}</span>
          </div>
        </div>
      </div>
      <div className="pad rise d3" style={{marginTop:16}}>
        <Chip kind="coral-soft" pulse>WAITING FOR FINAL LEADERBOARD</Chip>
      </div>
      <div className="pad rise d4" style={{marginTop:20}}>
        <DemoCard demo={demo} />
      </div>
    </Screen>
  );
}

function DemoCard({ demo, cta }) {
  return (
    <div style={{borderRadius:14, padding:'16px 18px', background:'var(--ink)', color:'var(--cream)'}}>
      <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:10}}><Spark color="var(--coral)"/><span className="label" style={{color:'rgba(245,242,234,0.55)', fontSize:10}}>{EVENT.nextAction.eyebrow}</span></div>
      <div className="h2" style={{fontSize:20, color:'var(--cream)'}}>{demo.name}</div>
      <div className="body" style={{fontSize:13, color:'rgba(245,242,234,0.7)', marginTop:6}}>{demo.why}</div>
      {cta && <div style={{marginTop:14}}><Btn kind="coral" onClick={cta}>{EVENT.nextAction.verb} {demo.name} {EVENT.nextAction.noun} →</Btn></div>}
    </div>
  );
}

function recommendDemo(you) {
  const na = EVENT.nextAction;
  const opts = na.options;
  if (!you) return opts[0];
  return you.hintsUsed > 0 ? opts[0] : (opts[1] || opts[0]);
}

// ---------------- RESULT ----------------
function PlayerResult() {
  const { state } = useGame();
  const ranked = rankedPlayers(state);
  const myIdx = ranked.findIndex(p=>p.isYou);
  const me = ranked[myIdx];
  const winner = ranked.find(p=>p.score) || null;
  const demo = recommendDemo(me);
  const myRank = myIdx>=0 ? myIdx+1 : null;
  return (
    <Screen footer={
      <div className="stack" style={{'--gap':'10px'}}>
        <Btn kind="coral">{EVENT.nextAction.verb} {demo.name} {EVENT.nextAction.noun} →</Btn>
        <Btn kind="ghost">Play the next round</Btn>
      </div>
    }>
      <div className="pad" style={{paddingTop:16}}><Wordmark /></div>
      <div className="pad" style={{paddingTop:26, textAlign:'center'}}>
        {myRank ? (
          <React.Fragment>
            <div className="label rise">YOUR RANK</div>
            <div className="display rise d1" style={{fontSize:96, marginTop:6, lineHeight:0.85}}>
              {myRank===1 ? <span className="coral">#1</span> : `#${myRank}`}
            </div>
            <div className="body rise d2" style={{marginTop:10}}>
              of {ranked.length} players · {me?.score ? `${me.score.points} pts` : 'in progress'}
            </div>
          </React.Fragment>
        ) : (
          <div className="display" style={{fontSize:40}}>Round over</div>
        )}
      </div>

      {winner && (
        <div className="pad rise d2" style={{marginTop:20}}>
          <div style={{background: myRank===1?'var(--coral)':'var(--ink)', color: myRank===1?'#fff':'var(--cream)', borderRadius:14, padding:'15px 18px', display:'flex', alignItems:'center', gap:13}}>
            <span style={{fontSize:26}}>🏆</span>
            <div style={{flex:1}}>
              <div className="label" style={{color:'rgba(255,255,255,0.6)'}}>{myRank===1?'THAT\u2019S YOU':'ROUND WINNER'}</div>
              <div className="h2" style={{fontSize:20, color:'#fff'}}>{winner.name}</div>
            </div>
            <div className="h2 tnum" style={{fontSize:22, color:'#fff'}}>{fmtTime(winner.score.raw)}</div>
          </div>
        </div>
      )}

      <div className="pad rise d3" style={{marginTop:20}}>
        <div className="label" style={{marginBottom:6}}>LEADERBOARD</div>
        {ranked.slice(0,6).map((p,i)=>(
          <LbRow key={p.id} rank={i+1} player={p} cfg={state.config} lead={i===0} />
        ))}
      </div>

      <div className="pad rise d4" style={{marginTop:18}}>
        <DemoCard demo={demo} />
      </div>
    </Screen>
  );
}

// ---------------- ROUTER ----------------
function PlayerSurface() {
  const { state } = useGame();
  const p = state.phase;
  const you = state.you;
  if (!you) {
    if (p==='home'||p==='setup'||p==='builder') return (
      <Screen><div className="pad" style={{paddingTop:46, textAlign:'center'}}>
        <Wordmark/><div className="h1" style={{fontSize:28, marginTop:24}}>No active session</div>
        <p className="body" style={{marginTop:12}}>Waiting for the organizer to open a lobby. The QR will appear on the booth screen.</p>
      </div></Screen>
    );
    if (p==='lobby') return <PlayerJoin/>;
    if (p==='countdown'||p==='live') return state.config.allowLate ? <PlayerJoin/> : <PlayerJoin locked/>;
    return <PlayerJoin locked/>;
  }
  if (p==='lobby') return <PlayerWaiting/>;
  if (p==='countdown') return <PlayerCountdown/>;
  if (p==='live') return you.finishMs!=null ? <PlayerCompletion/> : <PlayerGame/>;
  if (p==='winner') return <PlayerResult/>;
  return <PlayerWaiting/>;
}

Object.assign(window, { PlayerSurface, DemoCard });
