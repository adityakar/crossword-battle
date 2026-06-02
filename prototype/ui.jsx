/* ============================================================
   ui.jsx — shared components for all surfaces
   ============================================================ */

// ---------- brand mark ----------
function Mark({ size = 22, on = 'ink' }) {
  // tiny crossword-grid glyph: 3×3, two cells inked, one coral
  const g = size / 3;
  const base = on === 'cream' ? '#F5F2EA' : '#1F1B19';
  const fills = {
    '0,0': base, '1,1': base, '2,2': base,
    '2,0': '#FE414D', '0,2': base,
  };
  const cells = [];
  for (let r=0;r<3;r++) for (let c=0;c<3;c++) {
    const f = fills[`${r},${c}`];
    cells.push(<rect key={`${r}${c}`} x={c*g} y={r*g} width={g-1.5} height={g-1.5} rx={1} fill={f || 'transparent'} stroke={f?undefined:(on==='cream'?'rgba(245,242,234,0.35)':'rgba(31,27,25,0.22)')} strokeWidth={f?0:1} />);
  }
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{display:'block'}}>{cells}</svg>;
}

function Wordmark({ on='ink', sub=true }) {
  const ink = on==='cream' ? 'var(--cream)' : 'var(--ink)';
  const grey = on==='cream' ? 'rgba(245,242,234,0.6)' : 'var(--grey-soft)';
  return (
    <div style={{display:'flex', alignItems:'center', gap:10}}>
      <Mark size={22} on={on} />
      <div style={{lineHeight:1}}>
        <div className="h3" style={{fontSize:15, color:ink, letterSpacing:'-0.01em'}}>{EVENT.appName}</div>
        {sub && <div className="label" style={{fontSize:9, color:grey, marginTop:3}}>{EVENT.eventLine}</div>}
      </div>
    </div>
  );
}

// ---------- status bar ----------
function StatusBar({ dark=false, time='9:41' }) {
  const c = dark ? 'var(--cream)' : 'var(--ink)';
  return (
    <div className="statusbar" style={{color:c}}>
      <span className="tnum">{time}</span>
      <div style={{display:'flex', alignItems:'center', gap:7}}>
        <span style={{fontSize:11, letterSpacing:'0.06em'}}>5G</span>
        <svg width="22" height="11" viewBox="0 0 22 11" fill="none">
          <rect x="0.5" y="0.5" width="18" height="10" rx="2.5" stroke={dark?'rgba(245,242,234,0.5)':'rgba(31,27,25,0.4)'}/>
          <rect x="2" y="2" width="14" height="7" rx="1.2" fill={c}/>
          <rect x="20" y="3.5" width="1.5" height="4" rx="0.75" fill={c} opacity="0.5"/>
        </svg>
      </div>
    </div>
  );
}

// ---------- frames ----------
function PhoneFrame({ dark=false, time='9:41', label, children }) {
  return (
    <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:16}}>
      {label && <div className="label" style={{fontSize:10}}>{label}</div>}
      <div className="phone">
        <div className="phone-island" />
        <div className={'phone-screen' + (dark?' dark':'')}>
          <StatusBar dark={dark} time={time} />
          {children}
          <div className="home-indicator" />
        </div>
      </div>
    </div>
  );
}

function DisplayFrame({ label, children }) {
  return (
    <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:16}}>
      {label && <div className="label" style={{fontSize:10}}>{label}</div>}
      <div className="display-frame">
        <div className="display-screen">{children}</div>
      </div>
    </div>
  );
}

// generic screen scaffold (scroll area + optional sticky footer)
function Screen({ children, footer, dark=false, pad=true }) {
  return (
    <React.Fragment>
      <div className="screen-scroll" style={{paddingBottom: footer?0:34}}>
        <div style={{padding: pad?'4px 0 24px':0}}>{children}</div>
      </div>
      {footer && (
        <div style={{padding:'14px 22px 30px', borderTop:'1px solid var(--line)',
          background: dark?'var(--night-2)':'var(--paper)'}}>
          {footer}
        </div>
      )}
    </React.Fragment>
  );
}

// ---------- buttons ----------
function Btn({ kind='coral', children, onClick, disabled, className='', style }) {
  return (
    <button className={`btn btn-${kind} ${className}`} onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  );
}

// ---------- chips ----------
function Chip({ kind='line', children, pulse=false, style }) {
  return (
    <span className={`chip chip-${kind}`} style={style}>
      {pulse && <span className="dot dot-pulse" />}
      {children}
    </span>
  );
}

// ---------- key/value ----------
function KV({ k, v, vClass='', sub }) {
  return (
    <div className="kv" style={{padding:'13px 0', borderBottom:'1px solid var(--line)'}}>
      <span className="label">{k}</span>
      <span className={`h3 tnum ${vClass}`} style={{fontSize:16}}>{v}{sub && <span className="label" style={{marginLeft:6}}>{sub}</span>}</span>
    </div>
  );
}

function Stat({ n, label, coral=false }) {
  return (
    <div>
      <div className={'h1 tnum'+(coral?' coral':'')} style={{fontSize:34, lineHeight:1}}>{n}</div>
      <div className="label" style={{marginTop:6}}>{label}</div>
    </div>
  );
}

// ---------- progress bar ----------
function Bar({ value, coral=false }) {
  return (
    <div className="bar">
      <div className={'bar-fill'+(coral?' coral':'')} style={{width:`${Math.round(value*100)}%`}} />
    </div>
  );
}

// ---------- leaderboard row ----------
function LbRow({ rank, player, cfg, lead=false, showProgress=false, big=false }) {
  const sc = player.score;
  const initials = player.name.split(' ').map(w=>w[0]).slice(0,2).join('');
  return (
    <div className={'lb-row'+(lead?' lead':'')} style={big?{padding:'18px 4px'}:undefined}>
      <span className="lb-rank" style={big?{fontSize:20}:undefined}>{rank}</span>
      <div style={{minWidth:0}}>
        <div style={{display:'flex', alignItems:'center', gap:9}}>
          <span className="lb-name" style={{...(big?{fontSize:22}:{}), ...(player.isYou?{}:{})}}>
            {player.name}{player.isYou && <span className="label-coral" style={{marginLeft:8, fontFamily:'var(--mono)', fontSize:10}}>YOU</span>}
          </span>
        </div>
        {showProgress && player.finishMs==null && (
          <div style={{marginTop:7, maxWidth:big?320:180}}><Bar value={player.progress} coral={lead} /></div>
        )}
        {showProgress && player.finishMs==null && (
          <div className="label" style={{marginTop:6, fontSize:9}}>
            {Math.round(player.progress*100)}% · {player.hintsUsed} hint{player.hintsUsed!==1?'s':''} · {player.wrongAttempts} wrong
          </div>
        )}
      </div>
      <div style={{textAlign:'right'}}>
        {sc ? (
          <React.Fragment>
            <div className={'h3 tnum'+(lead?' coral':'')} style={{fontSize:big?22:16}}>{sc.points}</div>
            <div className="lb-time">{fmtTime(sc.raw)}{sc.pen>0 && <span className="grey"> +{sc.pen}s</span>}</div>
          </React.Fragment>
        ) : (
          <Chip kind={lead?'coral-soft':'line'}>{player.finishMs!=null?'done':'solving'}</Chip>
        )}
      </div>
    </div>
  );
}

// ---------- crossword grid (generic: any size, black squares, var lengths) ----------
function Crossword({ puzzle, entries={}, sel, onSelect, cellSize=56, reveal=false, interactive=true, dim=false }) {
  if (!puzzle) return null;
  const activeWord = sel ? pWordAt(puzzle, sel.r, sel.c, sel.dir) : null;
  const inWordSet = new Set(activeWord ? activeWord.cells.map(([r,c])=>`${r},${c}`) : []);
  const rows = [];
  for (let r=0;r<puzzle.rows;r++) {
    for (let c=0;c<puzzle.cols;c++) {
      const key = `${r},${c}`;
      if (pIsBlock(puzzle,r,c)) {
        rows.push(<div key={key} className="cell block" style={{width:cellSize, height:cellSize}} />);
        continue;
      }
      const num = puzzle.numbers[key];
      const inWord = inWordSet.has(key);
      const active = sel && sel.r===r && sel.c===c;
      const letter = reveal ? puzzle.grid[r][c] : (entries[key] || '');
      rows.push(
        <div key={key}
          className={'cell'+(inWord?' inword':'')+(active?' active':'')}
          style={{width:cellSize, height:cellSize, fontSize:cellSize*0.5,
            opacity: dim?0.55:1, cursor: interactive?'pointer':'default'}}
          onClick={interactive ? () => onSelect && onSelect(r,c) : undefined}>
          {num && <span className="cell-num" style={{fontSize:Math.max(8,cellSize*0.16)}}>{num}</span>}
          {letter}
        </div>
      );
    }
  }
  return <div className="xw" style={{gridTemplateColumns:`repeat(${puzzle.cols}, ${cellSize}px)`}}>{rows}</div>;
}

// ---------- clue card ----------
function ClueCard({ clue, dir, num, onPrev, onNext, index, total }) {
  return (
    <div className="card" style={{padding:'14px 16px'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12}}>
        <div style={{display:'flex', alignItems:'center', gap:10, minWidth:0}}>
          <span className="chip chip-ink" style={{flexShrink:0}}>{num} {dir==='across'?'ACROSS':'DOWN'}</span>
          <span className="h3" style={{fontSize:16}}>{clue}</span>
        </div>
      </div>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:12}}>
        <span className="label">{index}/{total}</span>
        <div style={{display:'flex', gap:8}}>
          <button className="btn btn-ghost btn-sm" onClick={onPrev} style={{padding:'8px 12px'}}>‹ Prev</button>
          <button className="btn btn-ghost btn-sm" onClick={onNext} style={{padding:'8px 12px'}}>Next ›</button>
        </div>
      </div>
    </div>
  );
}

// ---------- hint card (AI whisper) ----------
function HintCard({ text, penalty, remaining, dark=false }) {
  return (
    <div style={{
      borderRadius:14, padding:'16px 18px',
      background: dark? 'rgba(254,65,77,0.12)':'var(--coral-tint)',
      border:'1px solid var(--coral-line)',
      position:'relative',
    }}>
      <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:9}}>
        <Spark />
        <span className="label label-coral" style={{fontSize:10}}>AI HINT</span>
        <span className="label" style={{marginLeft:'auto', fontSize:10}}>{remaining} LEFT</span>
      </div>
      <div className="body body-ink" style={{fontSize:15, fontStyle:'italic', lineHeight:1.45}}>"{text}"</div>
      <div className="label" style={{marginTop:11, fontSize:10}}>PENALTY · +{penalty}s ADDED TO YOUR TIME</div>
    </div>
  );
}

function Spark({ size=14, color='var(--coral)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M7 0L8.4 5.6L14 7L8.4 8.4L7 14L5.6 8.4L0 7L5.6 5.6L7 0Z" fill={color}/>
    </svg>
  );
}

// ---------- on-screen letter pad ----------
function LetterPad({ onKey, onBackspace, onSubmit, dark=false }) {
  const rows = ['QWERTYUIOP','ASDFGHJKL','ZXCVBNM'];
  const keyStyle = {
    height:46, borderRadius:8, flex:1, minWidth:0,
    display:'flex', alignItems:'center', justifyContent:'center',
    fontFamily:'var(--head)', fontWeight:600, fontSize:18,
    background: dark?'rgba(245,242,234,0.1)':'var(--paper)',
    color: dark?'var(--cream)':'var(--ink)',
    border:'1px solid '+(dark?'rgba(245,242,234,0.12)':'var(--line)'),
    cursor:'pointer', userSelect:'none',
  };
  return (
    <div style={{display:'flex', flexDirection:'column', gap:7, padding:'12px 8px 8px',
      background: dark?'var(--night-2)':'var(--paper-edge)', borderTop:'1px solid var(--line)'}}>
      {rows.map((row,i)=>(
        <div key={i} style={{display:'flex', gap:6, padding: i===1?'0 16px':(i===2?'0 0':'0')}}>
          {i===2 && <div onClick={onBackspace} style={{...keyStyle, flex:1.5, fontSize:13, fontFamily:'var(--mono)'}}>DEL</div>}
          {row.split('').map(l=>(
            <div key={l} onClick={()=>onKey(l)} style={keyStyle}>{l}</div>
          ))}
          {i===2 && <div onClick={onSubmit} style={{...keyStyle, flex:1.5, background:'var(--coral)', color:'#fff', border:'none', fontSize:13, fontFamily:'var(--mono)'}}>✓</div>}
        </div>
      ))}
    </div>
  );
}

// ---------- QR code (deterministic pseudo-QR, squares only) ----------
function QR({ size=180, seed='SPRINT', fg='var(--ink)', bg='transparent' }) {
  const N = 25;
  // deterministic pattern
  const rnd = (() => {
    let h = 2166136261;
    for (let i=0;i<seed.length;i++){ h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => { h ^= h<<13; h ^= h>>>17; h ^= h<<5; return ((h>>>0)%1000)/1000; };
  })();
  const m = Array.from({length:N},()=>Array(N).fill(false));
  const isFinder = (r,c) => {
    const inBox = (br,bc)=> r>=br && r<br+7 && c>=bc && c<bc+7;
    return inBox(0,0)||inBox(0,N-7)||inBox(N-7,0);
  };
  for (let r=0;r<N;r++) for (let c=0;c<N;c++) if (!isFinder(r,c)) m[r][c] = rnd() > 0.5;
  const cs = size/N;
  const rects = [];
  for (let r=0;r<N;r++) for (let c=0;c<N;c++) if (m[r][c]) rects.push(<rect key={`${r},${c}`} x={c*cs} y={r*cs} width={cs} height={cs} fill={fg}/>);
  const finder = (x,y)=>(
    <React.Fragment key={`f${x}${y}`}>
      <rect x={x*cs} y={y*cs} width={7*cs} height={7*cs} fill={fg}/>
      <rect x={(x+1)*cs} y={(y+1)*cs} width={5*cs} height={5*cs} fill={bg==='transparent'?'var(--cream)':bg}/>
      <rect x={(x+2)*cs} y={(y+2)*cs} width={3*cs} height={3*cs} fill={fg}/>
    </React.Fragment>
  );
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{display:'block'}}>
      {bg!=='transparent' && <rect width={size} height={size} fill={bg}/>}
      {rects}
      {finder(0,0)}{finder(N-7,0)}{finder(0,N-7)}
    </svg>
  );
}

Object.assign(window, {
  Mark, Wordmark, StatusBar, PhoneFrame, DisplayFrame, Screen,
  Btn, Chip, KV, Stat, Bar, LbRow, Crossword, ClueCard, HintCard, Spark, LetterPad, QR,
});
