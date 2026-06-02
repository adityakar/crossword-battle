/* ============================================================
   organizer.jsx — the live game-show controller (phone)
   ============================================================ */

function OrgHeader({ right }) {
  return (
    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'8px 22px 14px', borderBottom:'1px solid var(--line)'}}>
      <Wordmark />
      {right}
    </div>
  );
}

function Stepper({ value, set, min, max, step=1, suffix='' }) {
  const btn = {
    width:40, height:40, borderRadius:9, border:'1px solid var(--line-2)',
    background:'var(--paper)', fontFamily:'var(--head)', fontSize:20, fontWeight:600,
    color:'var(--ink)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
  };
  return (
    <div style={{display:'flex', alignItems:'center', gap:12}}>
      <button style={btn} onClick={()=>set(Math.max(min, value-step))}>–</button>
      <div className="h2 tnum" style={{fontSize:24, minWidth:64, textAlign:'center'}}>{value}<span className="label" style={{marginLeft:3}}>{suffix}</span></div>
      <button style={btn} onClick={()=>set(Math.min(max, value+step))}>+</button>
    </div>
  );
}

function Toggle({ on, set }) {
  return (
    <button onClick={()=>set(!on)} style={{
      width:52, height:30, borderRadius:100, border:'none', cursor:'pointer', position:'relative',
      background: on?'var(--coral)':'var(--line-3)',
    }}>
      <span style={{position:'absolute', top:3, left: on?25:3, width:24, height:24, borderRadius:100,
        background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,0.25)'}}/>
    </button>
  );
}

// ---------------- HOME ----------------
function OrgHome() {
  const { state, dispatch } = useGame();
  const h = state.history;
  return (
    <Screen footer={
      <div className="stack" style={{'--gap':'10px'}}>
        <Btn kind="coral" onClick={()=>dispatch({type:'GOTO',phase:'setup'})}>Create New Session →</Btn>
        <Btn kind="ghost" onClick={()=>dispatch({type:'OPEN_LOBBY'})}>Resume Last Session</Btn>
      </div>
    }>
      <OrgHeader right={<Chip kind="line">ORGANIZER</Chip>} />
      <div className="pad" style={{paddingTop:30}}>
        <div className="label rise">{EVENT.venueLabel.toUpperCase()} · LIVE GAME SHOW</div>
        <div className="display rise d1" style={{fontSize:54, marginTop:14}}>{EVENT.appName}<span className="coral">.</span></div>
        <p className="body rise d2" style={{fontSize:15, marginTop:16, maxWidth:300}}>
          Run a two-minute crossword challenge for the floor. Players join by QR, the fastest correct solve wins.
        </p>
      </div>
      <div className="pad rise d3" style={{marginTop:30}}>
        <div className="label" style={{marginBottom:14}}>TODAY · WEDNESDAY</div>
        <div className="card" style={{padding:'22px 20px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8}}>
          <Stat n={h.rounds} label="ROUNDS" />
          <Stat n={h.players} label="PLAYERS" />
          <Stat n={h.winners} label="WINNERS" coral />
        </div>
        <div className="well" style={{marginTop:12, padding:'14px 16px', display:'flex', alignItems:'center', gap:10}}>
          <span className="dot" style={{color:'var(--grey-soft)'}}/>
          <span className="body" style={{fontSize:13}}>Last winner — <span className="body-ink" style={{fontWeight:600}}>Priya Nair</span>, 1:12 · 1 hint</span>
        </div>
      </div>
    </Screen>
  );
}

// ---------------- SETUP ----------------
function OrgSetup() {
  const { state, dispatch } = useGame();
  const cfg = state.config;
  const setCfg = (patch)=>dispatch({type:'SET_CONFIG', patch});
  return (
    <Screen footer={
      <Btn kind="coral" onClick={()=>dispatch({type:'OPEN_LOBBY'})}>Open Lobby →</Btn>
    }>
      <OrgHeader right={<Chip kind="line">ROUND {state.round}</Chip>} />
      <div className="pad" style={{paddingTop:22}}>
        <div className="label">SESSION SETUP</div>
        <div className="h1" style={{fontSize:32, marginTop:8}}>Configure round</div>
      </div>

      {/* puzzle */}
      <div className="pad" style={{marginTop:24}}>
        <div className="kv" style={{marginBottom:11}}>
          <span className="label">PUZZLE</span>
          <button onClick={()=>dispatch({type:'GOTO',phase:'builder'})}
            style={{display:'inline-flex', alignItems:'center', gap:6, background:'transparent', border:'none', cursor:'pointer',
              fontFamily:'var(--mono)', fontSize:11, letterSpacing:'0.08em', color:'var(--coral)', fontWeight:500}}>
            <Spark size={11}/> CREATE NEW
          </button>
        </div>
        <div className="stack" style={{'--gap':'8px'}}>
          {[...state.customPuzzles, ...PUZZLES].map(p=>{
            const on = cfg.puzzleId===p.id;
            return (
              <button key={p.id} onClick={()=>dispatch({type:'SET_PUZZLE', id:p.id})}
                style={{textAlign:'left', width:'100%', cursor:'pointer', padding:'14px 16px',
                  borderRadius:12, background: on?'var(--paper)':'transparent',
                  border:'1.5px solid '+(on?'var(--coral)':'var(--line)'),
                  display:'flex', alignItems:'center', justifyContent:'space-between', gap:12}}>
                <div style={{minWidth:0}}>
                  <div className="h3" style={{fontSize:16}}>{p.name}</div>
                  <div className="label" style={{marginTop:5}}>{p.sub}</div>
                </div>
                <div style={{display:'flex', alignItems:'center', gap:10, flexShrink:0}}>
                  {p.tag==='AI-generated' && <span className="chip chip-coral-soft"><Spark size={10}/>AI</span>}
                  {p.tag==='Custom' && <span className="chip chip-line">YOURS</span>}
                  <span style={{width:18, height:18, borderRadius:100, border:'2px solid '+(on?'var(--coral)':'var(--line-3)'),
                    background: on?'var(--coral)':'transparent', display:'flex', alignItems:'center', justifyContent:'center'}}>
                    {on && <span style={{width:6,height:6,borderRadius:100,background:'#fff'}}/>}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* difficulty */}
      <div className="pad" style={{marginTop:26}}>
        <div className="label" style={{marginBottom:11}}>DIFFICULTY</div>
        <div style={{display:'flex', flexWrap:'wrap', gap:8}}>
          {DIFFICULTIES.map(d=>{
            const on = cfg.difficulty===d.id;
            return (
              <button key={d.id} onClick={()=>dispatch({type:'SET_DIFFICULTY', id:d.id})}
                style={{cursor:'pointer', padding:'10px 14px', borderRadius:100,
                  border:'1.5px solid '+(on?'var(--coral)':'var(--line-2)'),
                  background: on?'var(--coral)':'transparent', color: on?'#fff':'var(--ink)',
                  fontFamily:'var(--head)', fontWeight:600, fontSize:14}}>
                {d.name}
              </button>
            );
          })}
        </div>
        <div className="body" style={{fontSize:13, marginTop:12}}>
          {DIFFICULTIES.find(d=>d.id===cfg.difficulty).sub}
        </div>
      </div>

      {/* numeric settings */}
      <div className="pad" style={{marginTop:26}}>
        <div className="card" style={{padding:'4px 18px'}}>
          <div className="kv" style={{padding:'18px 0', borderBottom:'1px solid var(--line)'}}>
            <div><div className="h3" style={{fontSize:15}}>Duration</div><div className="label" style={{marginTop:4}}>ROUND CLOCK</div></div>
            <Stepper value={cfg.durationSec} set={v=>setCfg({durationSec:v})} min={30} max={300} step={15} suffix="s" />
          </div>
          <div className="kv" style={{padding:'18px 0', borderBottom:'1px solid var(--line)'}}>
            <div><div className="h3" style={{fontSize:15}}>Hint penalty</div><div className="label" style={{marginTop:4}}>PER AI HINT</div></div>
            <Stepper value={cfg.hintPenalty} set={v=>setCfg({hintPenalty:v})} min={0} max={30} step={1} suffix="s" />
          </div>
          <div className="kv" style={{padding:'18px 0', borderBottom:'1px solid var(--line)'}}>
            <div><div className="h3" style={{fontSize:15}}>Wrong-answer penalty</div><div className="label" style={{marginTop:4}}>PER MISTAKE</div></div>
            <Stepper value={cfg.wrongPenalty} set={v=>setCfg({wrongPenalty:v})} min={0} max={30} step={1} suffix="s" />
          </div>
          <div className="kv" style={{padding:'18px 0'}}>
            <div><div className="h3" style={{fontSize:15}}>Allow late joiners</div><div className="label" style={{marginTop:4}}>JOIN AFTER START</div></div>
            <Toggle on={cfg.allowLate} set={v=>setCfg({allowLate:v})} />
          </div>
        </div>
      </div>
    </Screen>
  );
}

// ---------------- LOBBY ----------------
function OrgLobby() {
  const { state, dispatch } = useGame();
  const joined = state.players.filter(p=>p.joined);
  const d = DIFFICULTIES.find(x=>x.id===state.config.difficulty);
  return (
    <Screen footer={
      <div className="stack" style={{'--gap':'10px'}}>
        <Btn kind="coral" disabled={joined.length<1} onClick={()=>dispatch({type:'START_COUNTDOWN'})}>
          Start Countdown →
        </Btn>
        <div className="btn-row">
          <Btn kind="ghost" onClick={()=>dispatch({type:'GOTO',phase:'setup'})}>Close Lobby</Btn>
          <Btn kind="ghost" onClick={()=>dispatch({type:'RESET'})}>Reset</Btn>
        </div>
      </div>
    }>
      <OrgHeader right={<Chip kind="coral-soft" pulse>LOBBY OPEN</Chip>} />
      <div className="pad" style={{paddingTop:20, textAlign:'center'}}>
        <div className="label">SCAN TO JOIN · {state.config.puzzleName.toUpperCase()}</div>
        <div className="card" style={{display:'inline-block', padding:18, marginTop:14, borderRadius:18}}>
          <QR size={188} seed={state.joinCode} />
        </div>
        <div style={{marginTop:16}}>
          <div className="label">JOIN CODE</div>
          <div className="h1 mono" style={{fontSize:38, letterSpacing:'0.04em', marginTop:6}}>{state.joinCode}</div>
        </div>
      </div>

      <div className="pad" style={{marginTop:22}}>
        <div className="kv" style={{marginBottom:10}}>
          <div className="label">PLAYERS JOINED</div>
          <div className="h2 tnum"><span className="coral">{joined.length}</span> <span className="grey" style={{fontSize:16}}>/ 8</span></div>
        </div>
        <div className="card" style={{padding:'4px 16px', minHeight:120}}>
          {joined.length===0 && <div className="body" style={{padding:'24px 0', textAlign:'center', fontSize:13}}>Waiting for players to scan…</div>}
          {joined.map((p,i)=>(
            <div key={p.id} className="pop" style={{display:'flex', alignItems:'center', gap:11, padding:'12px 0',
              borderBottom: i<joined.length-1?'1px solid var(--line)':'none'}}>
              <Avatar name={p.name} />
              <span className="h3" style={{fontSize:15, flex:1}}>{p.name}{p.isYou && <span className="label-coral" style={{marginLeft:8, fontSize:10}}>YOU</span>}</span>
              <span className="chip chip-line"><span className="dot" style={{color:'#3a9d6e'}}/>ready</span>
            </div>
          ))}
        </div>
        <div className="well" style={{marginTop:12, padding:'12px 15px', display:'flex', gap:10, alignItems:'center'}}>
          <span className="label" style={{fontSize:9}}>↗ MIRROR</span>
          <span className="body" style={{fontSize:12}}>Cast to the booth display for a big-screen lobby & live board.</span>
        </div>
      </div>
    </Screen>
  );
}

function Avatar({ name, size=32, coral=false }) {
  const initials = name ? name.split(' ').map(w=>w[0]).slice(0,2).join('') : '?';
  return (
    <div style={{width:size, height:size, borderRadius:9, flexShrink:0,
      background: coral?'var(--coral)':'var(--ink)', color: coral?'#fff':'var(--cream)',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:'var(--mono)', fontSize:size*0.34, fontWeight:600, letterSpacing:'0.02em'}}>
      {initials}
    </div>
  );
}

// ---------------- COUNTDOWN ----------------
function OrgCountdown() {
  const { state } = useGame();
  const ready = state.players.filter(p=>p.joined).length;
  return (
    <div className="screen-scroll" style={{background:'var(--ink)', display:'flex', flexDirection:'column'}}>
      <div style={{flex:1, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', padding:'0 24px', color:'var(--cream)'}}>
        <div className="label" style={{color:'rgba(245,242,234,0.55)', marginBottom:8}}>GET READY</div>
        <div key={state.countdownFrom} className="count-num pop" style={{fontSize:260, color:'var(--coral)'}}>{state.countdownFrom}</div>
        <div className="label" style={{color:'rgba(245,242,234,0.55)', marginTop:8}}>{state.config.puzzleName.toUpperCase()} · {fmtTime(state.config.durationSec)} CLOCK</div>
      </div>
      <div style={{padding:'0 24px 60px', display:'flex', justifyContent:'space-between', color:'var(--cream)'}}>
        <div><div className="h2 tnum" style={{fontSize:30, color:'var(--cream)'}}>{ready}</div><div className="label" style={{color:'rgba(245,242,234,0.55)', marginTop:4}}>PLAYERS READY</div></div>
        <div style={{textAlign:'right'}}><div className="h2" style={{fontSize:30, color:'var(--cream)'}}>5×5</div><div className="label" style={{color:'rgba(245,242,234,0.55)', marginTop:4}}>WORD SQUARE</div></div>
      </div>
    </div>
  );
}

// ---------------- LIVE CONTROL ----------------
function OrgLive() {
  const { state, dispatch } = useGame();
  const ranked = rankedPlayers(state);
  const leader = ranked[0];
  const remaining = liveRemaining(state);
  const danger = remaining <= 20;
  const finished = ranked.filter(p=>p.finishMs!=null).length;
  return (
    <Screen footer={
      <div className="stack" style={{'--gap':'10px'}}>
        <div className="btn-row">
          <Btn kind="ghost" onClick={()=>dispatch({type:'PAUSE_TOGGLE'})}>{state.paused?'Resume':'Pause'}</Btn>
          <Btn kind="ghost" onClick={()=>dispatch({type:'TOGGLE_LB'})}>{state.showLeaderboard?'Hide Board':'Show Board'}</Btn>
        </div>
        <Btn kind="dark" onClick={()=>dispatch({type:'END_ROUND'})}>End Round</Btn>
      </div>
    }>
      <OrgHeader right={<Chip kind={state.paused?'line':'coral-soft'} pulse={!state.paused}>{state.paused?'PAUSED':'LIVE'}</Chip>} />

      {/* timer */}
      <div className="pad" style={{paddingTop:18}}>
        <div className="kv" style={{alignItems:'flex-end'}}>
          <div>
            <div className="label">TIME REMAINING</div>
            <div className={'count-num tnum'+(danger?' coral':'')} style={{fontSize:72, marginTop:4}}>{fmtTime(remaining)}</div>
          </div>
          <div style={{textAlign:'right', paddingBottom:8}}>
            <div className="h2 tnum" style={{fontSize:26}}>{finished}<span className="grey" style={{fontSize:16}}>/{ranked.length}</span></div>
            <div className="label" style={{marginTop:4}}>FINISHED</div>
          </div>
        </div>
        <div style={{marginTop:12}}><Bar value={1 - remaining/state.config.durationSec} coral={danger} /></div>
      </div>

      {/* current leader */}
      {leader && (
        <div className="pad" style={{marginTop:18}}>
          <div style={{background:'var(--ink)', borderRadius:14, padding:'16px 18px', color:'var(--cream)',
            display:'flex', alignItems:'center', gap:14}}>
            <Avatar name={leader.name} coral size={42} />
            <div style={{flex:1}}>
              <div className="label" style={{color:'rgba(245,242,234,0.55)'}}>CURRENT LEADER</div>
              <div className="h2" style={{fontSize:22, color:'var(--cream)', marginTop:2}}>{leader.name}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div className="h2 tnum coral" style={{fontSize:24}}>{leader.score?leader.score.points:Math.round(leader.progress*100)+'%'}</div>
              <div className="label" style={{color:'rgba(245,242,234,0.55)', marginTop:2}}>{leader.score?'POINTS':'SOLVED'}</div>
            </div>
          </div>
        </div>
      )}

      {/* leaderboard */}
      {state.showLeaderboard ? (
        <div className="pad" style={{marginTop:20}}>
          <div className="label" style={{marginBottom:6}}>LIVE LEADERBOARD</div>
          <div>
            {ranked.map((p,i)=>(
              <LbRow key={p.id} rank={i+1} player={p} cfg={state.config} lead={i===0} showProgress />
            ))}
          </div>
          <div className="label" style={{marginTop:14, fontSize:9, display:'flex', gap:14}}>
            <span><span className="dot" style={{color:'#3a9d6e'}}/> ALL CONNECTED</span>
            <span>{ranked.reduce((a,p)=>a+(p.hintsUsed||0),0)} HINTS USED</span>
            <span>{ranked.reduce((a,p)=>a+(p.wrongAttempts||0),0)} WRONG</span>
          </div>
        </div>
      ) : (
        <div className="pad" style={{marginTop:20}}>
          <div className="well" style={{padding:'30px 20px', textAlign:'center'}}>
            <div className="label">LEADERBOARD HIDDEN</div>
            <div className="body" style={{fontSize:13, marginTop:8}}>Players can't see ranks — build the suspense.</div>
          </div>
        </div>
      )}
    </Screen>
  );
}

// ---------------- WINNER ----------------
function OrgWinner() {
  const { state, dispatch } = useGame();
  const ranked = rankedPlayers(state).slice(0,5);
  const w = ranked.find(p=>p.score) || null;
  const line = w ? aiWinnerLine(w) : 'No finishers this round — the puzzle wins.';
  return (
    <Screen footer={
      <div className="stack" style={{'--gap':'10px'}}>
        <Btn kind={state.prizeGiven?'ghost':'coral'} disabled={state.prizeGiven} onClick={()=>dispatch({type:'MARK_PRIZE'})}>
          {state.prizeGiven?'✓ Prize Given':'Mark Prize Given'}
        </Btn>
        <Btn kind="dark" onClick={()=>dispatch({type:'NEXT_ROUND'})}>Start Next Round →</Btn>
      </div>
    }>
      <OrgHeader right={<Chip kind="ink">ROUND {state.round} · FINAL</Chip>} />
      {w ? (
        <div className="pad" style={{paddingTop:22}}>
          <div className="label rise">🏆 WINNER · {state.config.puzzleName.toUpperCase()}</div>
          <div className="display rise d1" style={{fontSize:48, marginTop:12}}>{w.name}</div>
          <div className="rise d2" style={{display:'flex', gap:26, marginTop:20}}>
            <div><div className="h1 tnum coral" style={{fontSize:34}}>{fmtTime(w.score.raw)}</div><div className="label" style={{marginTop:5}}>FINISH TIME</div></div>
            <div><div className="h1 tnum" style={{fontSize:34}}>{w.score.points}</div><div className="label" style={{marginTop:5}}>ADJ. SCORE</div></div>
            <div><div className="h1 tnum" style={{fontSize:34}}>+{w.score.pen}<span className="label">s</span></div><div className="label" style={{marginTop:5}}>PENALTY</div></div>
          </div>
          <div className="rise d3" style={{marginTop:20, borderRadius:14, padding:'15px 17px',
            background:'var(--coral-tint)', border:'1px solid var(--coral-line)'}}>
            <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:8}}><Spark/><span className="label label-coral" style={{fontSize:10}}>AI COMMENTARY</span></div>
            <div className="body body-ink" style={{fontSize:15, fontStyle:'italic'}}>"{line}"</div>
          </div>
        </div>
      ) : (
        <div className="pad" style={{paddingTop:40, textAlign:'center'}}>
          <div className="display" style={{fontSize:40}}>No solve.</div>
          <div className="body" style={{marginTop:12}}>{line}</div>
        </div>
      )}

      <div className="pad" style={{marginTop:24}}>
        <div className="label" style={{marginBottom:6}}>TOP 5</div>
        {ranked.map((p,i)=>(
          <LbRow key={p.id} rank={i+1} player={p} cfg={state.config} lead={i===0} />
        ))}
      </div>
    </Screen>
  );
}

function aiWinnerLine(w) {
  const t = w.score.raw;
  if (w.hintsUsed===0 && w.wrongAttempts===0) return `Clean sheet — no hints, no misses, ${fmtTime(t)} flat. The model is taking notes.`;
  if (w.hintsUsed>0) return `${fmtTime(t)} with a little help from the assistant. Resourceful is a strategy.`;
  return `${fmtTime(t)} and steady hands. A worthy floor champion.`;
}

function OrganizerSurface() {
  const { state } = useGame();
  const p = state.phase;
  if (p==='home') return <OrgHome/>;
  if (p==='setup') return <OrgSetup/>;
  if (p==='builder') return <OrgBuilder/>;
  if (p==='lobby') return <OrgLobby/>;
  if (p==='countdown') return <OrgCountdown/>;
  if (p==='live') return <OrgLive/>;
  if (p==='winner') return <OrgWinner/>;
  return <OrgHome/>;
}

Object.assign(window, { OrganizerSurface, Avatar, Stepper, Toggle });
