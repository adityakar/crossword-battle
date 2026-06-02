/* ============================================================
   app.jsx — stage, surface switcher, prototype conductor
   ============================================================ */
const { useState, useEffect, useRef } = React;

// scale a fixed-size design to fit its parent box
function Fit({ w, h, children, max=1 }) {
  const [scale, setScale] = useState(0.5);
  const ref = useRef(null);
  useEffect(() => {
    const calc = () => {
      const box = ref.current?.parentElement;
      if (!box) return;
      const aw = box.clientWidth - 8, ah = box.clientHeight - 8;
      setScale(Math.max(0.2, Math.min(max, aw/w, ah/h)));
    };
    calc();
    window.addEventListener('resize', calc);
    const t = setTimeout(calc, 50);
    return () => { window.removeEventListener('resize', calc); clearTimeout(t); };
  }, [w, h, max]);
  return (
    <div ref={ref} style={{ width:w*scale, height:h*scale }}>
      <div style={{ width:w, height:h, transform:`scale(${scale})`, transformOrigin:'top left' }}>{children}</div>
    </div>
  );
}

const PHASES = [
  { id:'home', label:'Home' },
  { id:'setup', label:'Setup' },
  { id:'lobby', label:'Lobby' },
  { id:'countdown', label:'Countdown' },
  { id:'live', label:'Live' },
  { id:'winner', label:'Winner' },
];

function ModeSwitch({ mode, setMode }) {
  const items = [
    { id:'organizer', label:'Organizer' },
    { id:'player', label:'Player' },
    { id:'display', label:'Display' },
    { id:'overview', label:'All Three' },
  ];
  return (
    <div style={{ display:'flex', gap:4, padding:4, background:'var(--paper-edge)', borderRadius:100, border:'1px solid var(--line)' }}>
      {items.map(it => (
        <button key={it.id} onClick={()=>setMode(it.id)} style={{
          padding:'9px 18px', borderRadius:100, border:'none', cursor:'pointer',
          fontFamily:'var(--mono)', fontSize:11, letterSpacing:'0.08em', fontWeight:500, textTransform:'uppercase',
          background: mode===it.id ? 'var(--ink)' : 'transparent',
          color: mode===it.id ? 'var(--cream)' : 'var(--grey)',
        }}>{it.label}</button>
      ))}
    </div>
  );
}

// prototype conductor — drive the round from any surface
function Conductor() {
  const { state, dispatch } = useGame();
  const p = state.phase;
  const joined = state.players.filter(x=>x.joined).length;
  let primary = null;
  if (p==='home') primary = { t:'Create session', a:()=>dispatch({type:'GOTO',phase:'setup'}) };
  else if (p==='setup') primary = { t:'Open lobby', a:()=>dispatch({type:'OPEN_LOBBY'}) };
  else if (p==='lobby') primary = { t:'Start countdown', a:()=>dispatch({type:'START_COUNTDOWN'}), dis: joined<1 };
  else if (p==='live') primary = { t:'End round', a:()=>dispatch({type:'END_ROUND'}) };
  else if (p==='winner') primary = { t:'Next round', a:()=>dispatch({type:'NEXT_ROUND'}) };

  return (
    <div style={{ display:'flex', alignItems:'center', gap:18, flexWrap:'wrap', justifyContent:'center' }}>
      <span className="label" style={{ fontSize:9 }}>PROTOTYPE CONDUCTOR</span>
      {/* phase rail */}
      <div style={{ display:'flex', alignItems:'center', gap:2 }}>
        {PHASES.map((ph,i)=>{
          const active = ph.id===p;
          const done = PHASES.findIndex(x=>x.id===p) > i;
          return (
            <React.Fragment key={ph.id}>
              {i>0 && <span style={{ width:14, height:1, background: done?'var(--coral)':'var(--line-2)' }}/>}
              <span style={{
                fontFamily:'var(--mono)', fontSize:10, letterSpacing:'0.06em', textTransform:'uppercase',
                padding:'5px 9px', borderRadius:100,
                background: active?'var(--coral)':'transparent',
                color: active?'#fff':(done?'var(--coral)':'var(--grey-soft)'),
                border:'1px solid '+(active?'var(--coral)':(done?'var(--coral-line)':'var(--line)')),
                whiteSpace:'nowrap',
              }}>{ph.label}</span>
            </React.Fragment>
          );
        })}
      </div>
      <div style={{ display:'flex', gap:8 }}>
        {primary && (
          <button className="btn btn-coral btn-sm" disabled={primary.dis} onClick={primary.a} style={{ width:'auto' }}>{primary.t} →</button>
        )}
        {p==='lobby' && joined<8 && (
          <button className="btn btn-ghost btn-sm" onClick={()=>dispatch({type:'BOT_JOIN'})} style={{ width:'auto' }}>+ Add player</button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={()=>dispatch({type:'RESET'})} style={{ width:'auto' }}>Reset</button>
      </div>
    </div>
  );
}

// surfaces wrapped in frames
function OrganizerView() {
  const { state } = useGame();
  const dark = state.phase==='countdown';
  return <PhoneFrame label="ORGANIZER · MOBILE" dark={dark}><OrganizerSurface/></PhoneFrame>;
}
function PlayerView() {
  const { state } = useGame();
  const dark = state.phase==='countdown' || (state.phase==='live' && state.you && state.you.finishMs==null);
  return <PhoneFrame label="PLAYER · MOBILE" dark={false}><PlayerSurface/></PhoneFrame>;
}
function DisplayView() {
  return <DisplayFrame label="PUBLIC DISPLAY · BOOTH SCREEN"><DisplaySurface/></DisplayFrame>;
}

function OverviewView() {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:34 }}>
      <DisplayFrame label="PUBLIC DISPLAY · BOOTH SCREEN"><DisplaySurface/></DisplayFrame>
      <div style={{ display:'flex', gap:48, alignItems:'flex-start' }}>
        <OrganizerView/>
        <PlayerView/>
      </div>
    </div>
  );
}

function Stage() {
  const [mode, setMode] = useState('organizer');
  const dims = {
    organizer: [384, 882],
    player:    [384, 882],
    display:   [1132, 704],
    overview:  [1132, 1620],
  };
  const [w,h] = dims[mode];
  let view = null;
  if (mode==='organizer') view = <OrganizerView/>;
  else if (mode==='player') view = <PlayerView/>;
  else if (mode==='display') view = <DisplayView/>;
  else view = <OverviewView/>;

  return (
    <div id="stage">
      <div className="stage-bg-grid" />
      {/* top bar */}
      <div style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'18px 28px', borderBottom:'1px solid var(--line)', position:'relative', zIndex:2,
        background:'rgba(245,242,234,0.8)', backdropFilter:'blur(8px)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:13 }}>
          <Mark size={26}/>
          <div>
            <div className="h3" style={{ fontSize:16 }}>{EVENT.appName}</div>
            <div className="label" style={{ fontSize:9, marginTop:2 }}>{EVENT.eventLine} · INTERACTIVE PROTOTYPE</div>
          </div>
        </div>
        <ModeSwitch mode={mode} setMode={setMode} />
      </div>

      {/* surface area */}
      <div style={{ flex:1, minHeight:0, width:'100%', display:'flex', alignItems:'center', justifyContent:'center',
        padding:'24px 20px', position:'relative', zIndex:1, overflow:'hidden' }}>
        <Fit w={w} h={h} max={1}>
          <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center' }}>
            {view}
          </div>
        </Fit>
      </div>

      {/* conductor */}
      <div style={{ width:'100%', padding:'14px 28px 18px', borderTop:'1px solid var(--line)',
        background:'rgba(245,242,234,0.85)', backdropFilter:'blur(8px)', position:'relative', zIndex:2 }}>
        <Conductor/>
      </div>
    </div>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.style.setProperty('--coral', EVENT.accent);
    document.title = `${EVENT.appName} — ${EVENT.edition}`;
  }, []);
  return (
    <GameProvider>
      <Stage/>
    </GameProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
