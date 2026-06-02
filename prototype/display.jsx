/* ============================================================
   display.jsx — the large booth screen (16:9, read from afar)
   ============================================================ */

function DispChrome({ children, right }) {
  const { state } = useGame();
  return (
    <div style={{position:'absolute', inset:0, display:'flex', flexDirection:'column', background:'var(--cream)'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'26px 40px', borderBottom:'1px solid var(--line)'}}>
        <div style={{display:'flex', alignItems:'center', gap:14}}>
          <Mark size={30}/>
          <div>
            <div className="h3" style={{fontSize:20}}>{EVENT.appName}</div>
            <div className="label" style={{fontSize:11, marginTop:3}}>{EVENT.eventLine} · {EVENT.venueLabel.toUpperCase()}</div>
          </div>
        </div>
        {right}
      </div>
      <div style={{flex:1, minHeight:0, position:'relative'}}>{children}</div>
    </div>
  );
}

const RECENT = [
  { name:'Priya Nair', t:'1:12', note:'1 hint' },
  { name:'Sven Holt', t:'1:28', note:'clean' },
  { name:'Maya Okafor', t:'1:34', note:'2 hints' },
];

function RecentWinners() {
  return (
    <div>
      <div className="label" style={{marginBottom:14}}>RECENT WINNERS</div>
      <div style={{display:'flex', flexDirection:'column', gap:12}}>
        {RECENT.map((w,i)=>(
          <div key={i} style={{display:'flex', alignItems:'center', gap:12}}>
            <span style={{fontSize:18}}>🏆</span>
            <span className="h3" style={{fontSize:17, flex:1}}>{w.name}</span>
            <span className="mono" style={{fontSize:15, color:'var(--grey)'}}>{w.t}</span>
            <span className="chip chip-line">{w.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- LOBBY ----------------
function DispLobby() {
  const { state } = useGame();
  const joined = state.players.filter(p=>p.joined);
  return (
    <DispChrome right={<Chip kind="coral-soft" pulse style={{fontSize:13, padding:'8px 14px'}}>LOBBY OPEN</Chip>}>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', height:'100%'}}>
        {/* QR panel */}
        <div style={{background:'var(--ink)', color:'var(--cream)', padding:'56px 56px', display:'flex', flexDirection:'column', justifyContent:'center'}}>
          <div className="label" style={{color:'rgba(245,242,234,0.55)'}}>SCAN WITH YOUR PHONE</div>
          <div className="display" style={{fontSize:56, color:'var(--cream)', marginTop:14}}>Play the<br/>floor<span className="coral">.</span></div>
          <div style={{display:'flex', alignItems:'center', gap:28, marginTop:40}}>
            <div style={{background:'var(--cream)', padding:16, borderRadius:16}}><QR size={170} seed={state.joinCode} bg="#F5F2EA"/></div>
            <div>
              <div className="label" style={{color:'rgba(245,242,234,0.55)'}}>OR ENTER CODE</div>
              <div className="h1 mono" style={{fontSize:44, color:'var(--coral)', marginTop:8, letterSpacing:'0.03em'}}>{state.joinCode}</div>
              <div className="body" style={{color:'rgba(245,242,234,0.6)', marginTop:14, fontSize:15, maxWidth:200}}>A 2-minute AI crossword. Fastest correct solve wins.</div>
            </div>
          </div>
        </div>
        {/* right */}
        <div style={{padding:'48px 48px', display:'flex', flexDirection:'column'}}>
          <div className="kv" style={{alignItems:'flex-end'}}>
            <div><div className="label">PLAYERS JOINED</div><div className="display tnum" style={{fontSize:120, lineHeight:0.85, marginTop:8}}>{joined.length}</div></div>
            <div className="label" style={{paddingBottom:14}}>{state.config.puzzleName.toUpperCase()} · {fmtTime(state.config.durationSec)}</div>
          </div>
          <div style={{display:'flex', flexWrap:'wrap', gap:10, margin:'26px 0', minHeight:80, alignContent:'flex-start'}}>
            {joined.map(p=>(
              <span key={p.id} className="pop chip chip-line" style={{fontSize:13, padding:'8px 14px', fontFamily:'var(--head)', textTransform:'none', letterSpacing:0}}>{p.name}</span>
            ))}
            {joined.length===0 && <span className="body" style={{fontSize:15}}>Waiting for the first scan…</span>}
          </div>
          <div style={{flex:1}}/>
          <hr className="hr" style={{margin:'0 0 24px'}}/>
          <RecentWinners/>
        </div>
      </div>
    </DispChrome>
  );
}

// ---------------- COUNTDOWN ----------------
function DispCountdown() {
  const { state } = useGame();
  const ready = state.players.filter(p=>p.joined).length;
  return (
    <div style={{position:'absolute', inset:0, background:'var(--ink)', color:'var(--cream)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center'}}>
      <div className="label" style={{color:'rgba(245,242,234,0.55)', fontSize:16}}>GET READY · {ready} PLAYERS</div>
      <div key={state.countdownFrom} className="count-num pop" style={{fontSize:420, color:'var(--coral)', margin:'-20px 0'}}>{state.countdownFrom}</div>
      <div className="label" style={{color:'rgba(245,242,234,0.55)', fontSize:16}}>{state.config.puzzleName.toUpperCase()} · {fmtTime(state.config.durationSec)} CLOCK</div>
    </div>
  );
}

// ---------------- LIVE ----------------
function DispLive() {
  const { state } = useGame();
  const ranked = rankedPlayers(state);
  const remaining = liveRemaining(state);
  const danger = remaining <= 20;
  const leader = ranked[0];
  return (
    <DispChrome right={
      <div style={{display:'flex', alignItems:'center', gap:18}}>
        {state.paused && <Chip kind="line" style={{fontSize:13, padding:'8px 14px'}}>PAUSED</Chip>}
        <div style={{textAlign:'right'}}>
          <div className="label" style={{fontSize:11}}>TIME LEFT</div>
          <div className={'count-num tnum'+(danger?' coral':'')} style={{fontSize:52, lineHeight:1}}>{fmtTime(remaining)}</div>
        </div>
      </div>
    }>
      <div style={{display:'grid', gridTemplateColumns:'1.7fr 1fr', height:'100%'}}>
        {/* leaderboard */}
        <div style={{padding:'30px 44px', overflow:'hidden'}}>
          <div className="label" style={{marginBottom:6}}>LIVE LEADERBOARD</div>
          {state.showLeaderboard ? ranked.slice(0,6).map((p,i)=>(
            <LbRow key={p.id} rank={i+1} player={p} cfg={state.config} lead={i===0} showProgress big />
          )) : (
            <div style={{display:'flex', alignItems:'center', justifyContent:'center', height:'80%'}}>
              <div style={{textAlign:'center'}}>
                <div className="display" style={{fontSize:56}}>Heads down<span className="coral">.</span></div>
                <div className="body" style={{fontSize:18, marginTop:12}}>Ranks revealed at the buzzer.</div>
              </div>
            </div>
          )}
        </div>
        {/* leader spotlight */}
        <div style={{background:'var(--ink)', color:'var(--cream)', padding:'40px 40px', display:'flex', flexDirection:'column', justifyContent:'center'}}>
          <div className="label" style={{color:'rgba(245,242,234,0.55)'}}>OUT IN FRONT</div>
          {leader ? (
            <React.Fragment>
              <div style={{display:'flex', alignItems:'center', gap:16, marginTop:18}}>
                <Avatar name={leader.name} coral size={64}/>
                <div className="h1" style={{fontSize:38, color:'var(--cream)'}}>{leader.name}</div>
              </div>
              <div className="display tnum coral" style={{fontSize:84, marginTop:24}}>
                {leader.score?leader.score.points:Math.round(leader.progress*100)+'%'}
              </div>
              <div className="label" style={{color:'rgba(245,242,234,0.55)', marginTop:4}}>{leader.score?'POINTS · '+fmtTime(leader.score.raw):'OF THE GRID SOLVED'}</div>
            </React.Fragment>
          ) : <div className="body" style={{color:'rgba(245,242,234,0.6)', marginTop:20}}>Waiting for the first letters…</div>}
          <div style={{flex:1}}/>
          <div className="label" style={{color:'rgba(245,242,234,0.45)'}}>{ranked.filter(p=>p.finishMs!=null).length} FINISHED · {ranked.length} PLAYING</div>
        </div>
      </div>
    </DispChrome>
  );
}

// ---------------- WINNER ----------------
function DispWinner() {
  const { state } = useGame();
  const ranked = rankedPlayers(state);
  const w = ranked.find(p=>p.score) || null;
  return (
    <DispChrome right={<Chip kind="ink" style={{fontSize:13, padding:'8px 14px'}}>ROUND {state.round} · FINAL</Chip>}>
      <div style={{display:'grid', gridTemplateColumns:'1.3fr 1fr', height:'100%'}}>
        <div style={{padding:'48px 56px', display:'flex', flexDirection:'column', justifyContent:'center'}}>
          {w ? (
            <React.Fragment>
              <div className="label rise" style={{color:'var(--coral)', fontSize:14}}>🏆 ROUND WINNER</div>
              <div className="display rise d1" style={{fontSize:88, marginTop:14}}>{w.name}</div>
              <div className="rise d2" style={{display:'flex', gap:48, marginTop:34}}>
                <div><div className="display tnum coral" style={{fontSize:56}}>{fmtTime(w.score.raw)}</div><div className="label" style={{marginTop:8}}>FINISH TIME</div></div>
                <div><div className="display tnum" style={{fontSize:56}}>{w.score.points}</div><div className="label" style={{marginTop:8}}>ADJ. SCORE</div></div>
                <div><div className="display tnum" style={{fontSize:56}}>+{w.score.pen}s</div><div className="label" style={{marginTop:8}}>PENALTY</div></div>
              </div>
              <div className="rise d3" style={{marginTop:34, display:'flex', gap:10, alignItems:'center', maxWidth:440}}>
                <Spark/><span className="body body-ink" style={{fontSize:17, fontStyle:'italic'}}>"{w.hintsUsed===0&&w.wrongAttempts===0?'A clean sheet. No hints, no misses.':'Fast hands and a little AI help.'} The floor has a champion."</span>
              </div>
            </React.Fragment>
          ) : <div className="display" style={{fontSize:64}}>No solve this round<span className="coral">.</span></div>}
        </div>
        <div style={{padding:'40px 44px', borderLeft:'1px solid var(--line)', display:'flex', flexDirection:'column'}}>
          <div className="label" style={{marginBottom:8}}>TOP 5</div>
          {ranked.slice(0,5).map((p,i)=>(
            <LbRow key={p.id} rank={i+1} player={p} cfg={state.config} lead={i===0} />
          ))}
          <div style={{flex:1}}/>
          <div style={{background:'var(--cream)', borderTop:'1px solid var(--line)', paddingTop:20, marginTop:20}}>
            <div className="label">NEXT ROUND OPENS SHORTLY</div>
            <div className="h3" style={{fontSize:18, marginTop:6}}>Scan again to play · <span className="mono coral">{state.joinCode}</span></div>
          </div>
        </div>
      </div>
    </DispChrome>
  );
}

// ---------------- IDLE ----------------
function DispIdle() {
  return (
    <DispChrome right={<Chip kind="line" style={{fontSize:13, padding:'8px 14px'}}>STANDBY</Chip>}>
      <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', textAlign:'center'}}>
        <div className="display" style={{fontSize:80}}>AI Crossword<br/>Sprint<span className="coral">.</span></div>
        <div className="body" style={{fontSize:20, marginTop:20}}>The next round is being set up at the booth.</div>
      </div>
    </DispChrome>
  );
}

function DisplaySurface() {
  const { state } = useGame();
  const p = state.phase;
  if (p==='lobby') return <DispLobby/>;
  if (p==='countdown') return <DispCountdown/>;
  if (p==='live') return <DispLive/>;
  if (p==='winner') return <DispWinner/>;
  return <DispIdle/>;
}

Object.assign(window, { DisplaySurface });
