/* ============================================================
   store.jsx — shared live game state for all three surfaces
   ============================================================ */

const { createContext, useContext, useReducer, useEffect, useRef, useState, useCallback } = React;

// ====================================================================
// WHITE-LABEL EVENT CONFIG — "Crossword Battle" is the product; each
// deployment is one event config. Swap ACTIVE_EVENT to re-skin the
// entire app (name, venue, accent, AI tone, the "what's next" CTA, terms).
// ====================================================================
const EVENTS = {
  'ai-expo': {
    id:'ai-expo',
    appName:'Crossword Battle',
    client:'Globex',
    edition:'AI Expo 2026',
    eventLine:'GLOBEX · AI EXPO 2026',   // mono sub-lockup
    venueLabel:'Booth 14',
    accent:'#FE414D',
    prizeLabel:'Prize',
    aiTone:'dry, confident, lightly witty',
    // the post-game "what to do next" CTA. Set enabled:false for events with no next stop.
    nextAction:{
      enabled:true,
      eyebrow:'AI RECOMMENDS NEXT',
      verb:'Visit the',
      noun:'demo',
      options:[
        { name:'TestKit', why:'You leaned on the assistant — see how it writes & runs test suites on its own.' },
        { name:'DataViz',  why:'Clean, fast, no help needed — explore synthetic data at production scale.' },
      ],
    },
    topicHint:'Generative AI buzzwords · The history of computing · Coffee',
  },
  // --- example second config: a team offsite / training day (re-skin demo) ---
  'team-offsite': {
    id:'team-offsite',
    appName:'Crossword Battle',
    client:'Acme Co.',
    edition:'Team Offsite',
    eventLine:'ACME CO. · TEAM OFFSITE',
    venueLabel:'Room B',
    accent:'#FE414D',
    prizeLabel:'Bragging rights',
    aiTone:'warm, encouraging, hype',
    nextAction:{
      enabled:true, eyebrow:'TRY NEXT', verb:'Head to', noun:'session',
      options:[
        { name:'Workshop B', why:'Momentum\u2019s on your side — keep it going in the hands-on track.' },
        { name:'The coffee bar', why:'You earned a break. Go gloat.' },
      ],
    },
    topicHint:'Company history · Inside jokes · Our product line',
  },
};
const EVENT = EVENTS['ai-expo'];   // ← active deployment

// ====================================================================
// GENERIC CROSSWORD ENGINE — every puzzle is a data object built from a
// grid of letters (null = black square). Words are auto-detected runs of
// length >= 2. Grids may be any rectangular size. Build presets up front,
// or generate a fresh layout from a list of {answer, clue} at runtime.
// ====================================================================

// build a full puzzle object from a rectangular grid + clue map (by answer)
function buildPuzzle(def) {
  const grid = def.grid;
  const rows = grid.length, cols = grid[0].length;
  const isB = (r,c) => r<0||c<0||r>=rows||c>=cols||grid[r][c]==null;
  const numbers = {};
  let n = 1;
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
    if (isB(r,c)) continue;
    const sA = isB(r,c-1) && !isB(r,c+1);
    const sD = isB(r-1,c) && !isB(r+1,c);
    if (sA || sD) numbers[`${r},${c}`] = n++;
  }
  const collect = (dir) => {
    const A = dir==='across', out = [];
    const outer = A?rows:cols, inner = A?cols:rows;
    for (let a=0;a<outer;a++) {
      let run = [];
      for (let b=0;b<inner;b++) {
        const r = A?a:b, c = A?b:a;
        if (isB(r,c)) { if (run.length>=2) out.push(run); run=[]; }
        else run.push([r,c]);
      }
      if (run.length>=2) out.push(run);
    }
    return out.map(cells => {
      const [sr,sc] = cells[0];
      const answer = cells.map(([r,c])=>grid[r][c]).join('');
      return { dir, num:numbers[`${sr},${sc}`], cells, answer,
        clue:(def.clues&&def.clues[answer])||'' };
    });
  };
  const across = collect('across'), down = collect('down');
  const cellToWord = {};
  across.forEach((w,i)=>w.cells.forEach(([r,c])=>{ (cellToWord[`${r},${c}`]||(cellToWord[`${r},${c}`]={})).across=i; }));
  down.forEach((w,i)=>w.cells.forEach(([r,c])=>{ (cellToWord[`${r},${c}`]||(cellToWord[`${r},${c}`]={})).down=i; }));
  const fill = []; let cellCount = 0;
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) if (!isB(r,c)) { fill.push([r,c]); cellCount++; }
  return {
    id:def.id||('p'+Math.random().toString(36).slice(2,7)), name:def.name||'Untitled',
    sub:def.sub||`${rows}×${cols} · ${across.length+down.length} words`, tag:def.tag||'Custom',
    grid, rows, cols, numbers, across, down, cellToWord, fill, cellCount,
    clues:def.clues||{}, topic:def.topic||null,
  };
}

// --- auto-layout generator: [{answer,clue}] -> puzzle (dynamic size) ---
function rngFrom(seed) {
  let s = seed>>>0 || 1;
  return () => { s ^= s<<13; s ^= s>>>17; s ^= s<<5; return ((s>>>0)%100000)/100000; };
}
function layoutAttempt(order) {
  const cells = new Map(), placed = [];
  const key=(r,c)=>r+','+c, get=(r,c)=>cells.get(key(r,c));
  const canPlace=(w,r,c,dir)=>{
    const dr=dir==='down'?1:0, dc=dir==='across'?1:0; let cross=0;
    if(get(r-dr,c-dc)!=null) return -1;
    if(get(r+dr*w.length,c+dc*w.length)!=null) return -1;
    for(let i=0;i<w.length;i++){const rr=r+dr*i,cc=c+dc*i,cur=get(rr,cc);
      if(cur!=null){ if(cur!==w[i]) return -1; cross++; }
      else{ if(dir==='across'){ if(get(rr-1,cc)!=null||get(rr+1,cc)!=null) return -1; }
            else { if(get(rr,cc-1)!=null||get(rr,cc+1)!=null) return -1; } }}
    return cross;
  };
  const place=(w,r,c,dir)=>{const dr=dir==='down'?1:0,dc=dir==='across'?1:0;
    for(let i=0;i<w.length;i++) cells.set(key(r+dr*i,c+dc*i), w[i]); placed.push({w,r,c,dir});};
  place(order[0],0,0,'across');
  // running bounding box — used to keep placements compact
  let bMinR=0,bMaxR=0,bMinC=0,bMaxC=order[0].length-1;
  let remaining=order.slice(1), progress=true, passes=0;
  while(remaining.length && progress && passes<8){
    progress=false; passes++; const still=[];
    for(const w of remaining){
      let best=null;
      for(let i=0;i<w.length;i++) for(const p of placed) for(let j=0;j<p.w.length;j++){
        if(p.w[j]!==w[i]) continue;
        const pr=p.dir==='down'?p.r+j:p.r, pc=p.dir==='across'?p.c+j:p.c;
        const dir=p.dir==='across'?'down':'across', dr=dir==='down'?1:0, dc=dir==='across'?1:0;
        const r=pr-dr*i, c=pc-dc*i, sc=canPlace(w,r,c,dir);
        if(sc<=0) continue;
        // bounding box if we placed here → prefer the most compact result
        const er=r+dr*(w.length-1), ec=c+dc*(w.length-1);
        const nR=Math.max(bMaxR,er)-Math.min(bMinR,r)+1;
        const nC=Math.max(bMaxC,ec)-Math.min(bMinC,c)+1;
        const dim=Math.max(nR,nC), area=nR*nC;
        // rank: more crossings first, then smaller max dimension, then smaller area
        if(!best || sc>best.sc || (sc===best.sc && (dim<best.dim || (dim===best.dim && area<best.area))))
          best={r,c,dir,sc,dim,area,er,ec};
      }
      if(best){ place(w,best.r,best.c,best.dir); progress=true;
        bMinR=Math.min(bMinR,best.r,best.er); bMaxR=Math.max(bMaxR,best.r,best.er);
        bMinC=Math.min(bMinC,best.c,best.ec); bMaxC=Math.max(bMaxC,best.c,best.ec);
      } else still.push(w);
    }
    remaining=still;
  }
  let minR=1e9,minC=1e9,maxR=-1e9,maxC=-1e9;
  for(const k of cells.keys()){const[r,c]=k.split(',').map(Number);minR=Math.min(minR,r);minC=Math.min(minC,c);maxR=Math.max(maxR,r);maxC=Math.max(maxC,c);}
  const rows=maxR-minR+1, cols=maxC-minC+1;
  const grid=Array.from({length:rows},()=>Array(cols).fill(null));
  for(const[k,v]of cells){const[r,c]=k.split(',').map(Number);grid[r-minR][c-minC]=v;}
  return { grid, rows, cols, placed:placed.map(p=>p.w), unplaced:remaining };
}
// returns { puzzle, placed:[answers], dropped:[answers] }
function generatePuzzle(entries, meta={}) {
  // entries: [{answer, clue}]
  const clean = entries
    .map(e=>({ answer:(e.answer||'').toUpperCase().replace(/[^A-Z]/g,''), clue:(e.clue||'').trim() }))
    .filter(e=>e.answer.length>=2);
  // dedupe answers
  const seen=new Set(); const uniq=[];
  for(const e of clean){ if(!seen.has(e.answer)){ seen.add(e.answer); uniq.push(e); } }
  if(uniq.length===0) return null;
  const words = uniq.map(e=>e.answer);
  const rng = rngFrom(meta.seed || 12345);
  let best=null;
  for(let t=0;t<90;t++){
    let order = words.slice();
    if(t===0) order.sort((a,b)=>b.length-a.length);
    else { order.sort(()=> rng()-0.5); if(t%2===0) order.sort((a,b)=>b.length-a.length); }
    const res = layoutAttempt(order);
    const dim = Math.max(res.rows,res.cols);
    if(dim>11) continue;                              // hard cap: keep it phone-friendly
    const sc = res.placed.length*1000 - dim*10 - res.rows*res.cols - Math.abs(res.rows-res.cols)*3;
    if(!best || sc>best.sc) best={...res, sc};
    if(res.placed.length===words.length && dim<=8 && Math.abs(res.rows-res.cols)<=2) break;
  }
  if(!best) return null;
  const clues = {}; uniq.forEach(e=>{ clues[e.answer]=e.clue; });
  const puzzle = buildPuzzle({ grid:best.grid, clues,
    name:meta.name||'Custom Puzzle', sub:meta.sub, tag:meta.tag||'Custom', topic:meta.topic });
  const placedSet = new Set(best.placed);
  return { puzzle, placed:best.placed, dropped:words.filter(w=>!placedSet.has(w)) };
}

// ---------- puzzle-aware helpers (operate on a puzzle object) ----------
const pIsBlock = (pz,r,c) => r<0||c<0||r>=pz.rows||c>=pz.cols||pz.grid[r][c]==null;
function pWordAt(pz, r, c, dir) {
  const ref = pz.cellToWord[`${r},${c}`]; if (!ref) return null;
  const idx = dir==='across' ? ref.across : ref.down; if (idx==null) return null;
  return (dir==='across'?pz.across:pz.down)[idx];
}
function pDirFor(pz, r, c, want) {
  const ref = pz.cellToWord[`${r},${c}`] || {};
  if (want==='across' && ref.across!=null) return 'across';
  if (want==='down' && ref.down!=null) return 'down';
  if (ref.across!=null) return 'across';
  if (ref.down!=null) return 'down';
  return 'across';
}
function pStep(pz, r, c, dir, delta) {
  const w = pWordAt(pz,r,c,dir); if (!w) return {r,c};
  const i = w.cells.findIndex(([rr,cc])=>rr===r&&cc===c), j=i+delta;
  if (j<0||j>=w.cells.length) return {r,c};
  return { r:w.cells[j][0], c:w.cells[j][1] };
}
function pProgress(pz, entries) {
  let correct = 0;
  for (const [r,c] of pz.fill) if (entries[`${r},${c}`] === pz.grid[r][c]) correct++;
  return pz.cellCount ? correct / pz.cellCount : 0;
}
function firstSel(pz) {
  const w = pz.across[0] || pz.down[0];
  const [r,c] = w.cells[0];
  return { r, c, dir:w.dir };
}

// ---------- preset puzzle library (built from word/clue lists) ----------
const PRESET_DEFS = [
  { id:'mini-ai', name:'Sprint Mini', tag:'AI-generated', topic:'Machine learning', seed:7,
    words:[
      ['MODEL','What you train on a pile of data'],
      ['AGENT','Autonomous AI that takes actions on its own'],
      ['DATA','The raw fuel every model learns from'],
      ['TOKEN','The chunk of text an LLM reads at a time'],
      ['LOGIC','Sound step-by-step reasoning'],
      ['LAYER','One tier of a neural network'],
    ]},
  { id:'mini-tech', name:'Stack Trace', tag:'AI-generated', topic:'Software engineering', seed:23,
    words:[
      ['CACHE','Fast storage for recently used data'],
      ['ARRAY','An ordered list of values, by index'],
      ['QUERY','A request sent to a database'],
      ['DEBUG','Hunt down and squash errors'],
      ['LOOP','A block that repeats'],
      ['BYTE','Eight bits'],
    ]},
  { id:'mini-expo', name:'Floor Plan', tag:'Curated', topic:'The expo floor', seed:41,
    words:[
      ['BOOTH','Where a team shows its demo'],
      ['BADGE','You scan it to check in'],
      ['DEMO','A live walkthrough of the product'],
      ['PRIZE','What the round winner takes home'],
      ['SCAN','What you do to the QR code'],
      ['EXPO','This whole event, for short'],
    ]},
];
function buildPresets() {
  return PRESET_DEFS.map(d => {
    const r = generatePuzzle(d.words.map(([a,c])=>({answer:a,clue:c})),
      { name:d.name, tag:d.tag, topic:d.topic, seed:d.seed });
    const pz = r.puzzle; pz.id = d.id; return pz;
  });
}
const PRESETS = buildPresets();

// ---------- difficulty presets ----------
const DIFFICULTIES = [
  { id:'easy',      name:'Easy',      sub:'Warm-up pace',           dur:180, hint:8,  wrong:4 },
  { id:'medium',    name:'Medium',    sub:'Expo standard',          dur:120, hint:10, wrong:5 },
  { id:'hard',      name:'Hard',      sub:'For the competitive',    dur:90,  hint:15, wrong:8 },
  { id:'poc',       name:'POC Mode',  sub:'Demo-safe, forgiving',   dur:240, hint:5,  wrong:0 },
  { id:'lightning', name:'Lightning', sub:'60 seconds. Go.',        dur:60,  hint:12, wrong:6 },
];

const PUZZLES = PRESETS;

// ---------- bot roster ----------
const ROSTER = [
  { id:'b1', name:'Maya Okafor' },
  { id:'b2', name:'Diego Santos' },
  { id:'b3', name:'Priya Nair' },
  { id:'b4', name:'Liam Walsh' },
  { id:'b5', name:'Hannah Berg' },
  { id:'b6', name:'Tomás Vidal' },
  { id:'b7', name:'Aisha Khan' },
  { id:'b8', name:'Noah Frost' },
  { id:'b9', name:'Yuki Tanaka' },
];

function seededFinish(i, durSec) {
  // deterministic spread of finish targets across the duration
  const frac = [0.46, 0.58, 0.63, 0.71, 0.78, 0.84, 0.9, 0.95, 1.05][i % 9];
  return Math.round(durSec * frac);
}
function seededHints(i)  { return [1,0,2,1,0,3,1,2,0][i % 9]; }
function seededWrong(i)  { return [0,1,1,2,0,1,3,1,2][i % 9]; }

function makeBot(r, i, durSec) {
  return {
    ...r, isYou:false, joined:false, joinAt:0,
    finishTarget: seededFinish(i, durSec),
    hintsUsed: 0, wrongAttempts: 0,
    plannedHints: seededHints(i), plannedWrong: seededWrong(i),
    progress: 0, finishMs: null, connected: true,
  };
}

// ---------- score ----------
function scoreFor(p, cfg) {
  if (p.finishMs == null) return null;
  const raw = p.finishMs / 1000;
  const pen = p.hintsUsed * cfg.hintPenalty + p.wrongAttempts * cfg.wrongPenalty;
  const adj = raw + pen;
  const points = Math.max(100, Math.round(2000 - adj * 6));
  return { raw, pen, adj, points };
}

// ---------- initial state ----------
function initState() {
  const def = DIFFICULTIES[1];
  const pz = PRESETS[0];
  return {
    phase: 'home',            // home | setup | builder | lobby | countdown | live | winner
    round: 1,
    joinCode: 'SPR-7K2',
    config: {
      puzzleId: pz.id, puzzleName: pz.name,
      difficulty:'medium', durationSec:def.dur,
      hintPenalty:def.hint, wrongPenalty:def.wrong,
      allowLate:true,
    },
    activePuzzle: pz,
    customPuzzles: [],        // organizer-created puzzles
    players: [],
    you: null,                // your player object
    entries: {},              // "r,c" -> letter (your grid)
    sel: firstSel(pz),
    startedAt: null,
    countdownFrom: 3,
    paused: false,
    pausedAccumMs: 0,
    showLeaderboard: true,
    prizeGiven: false,
    nowMs: Date.now(),
    lastJoinMs: 0,
    history: { rounds: 6, players: 41, winners: 6 },
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'GOTO': return { ...state, phase: action.phase };

    case 'SET_CONFIG': {
      const config = { ...state.config, ...action.patch };
      return { ...state, config };
    }
    case 'SET_DIFFICULTY': {
      const d = DIFFICULTIES.find(x => x.id === action.id);
      return { ...state, config: { ...state.config, difficulty:d.id, durationSec:d.dur, hintPenalty:d.hint, wrongPenalty:d.wrong } };
    }
    case 'SET_PUZZLE': {
      const all = [...PRESETS, ...state.customPuzzles];
      const pz = all.find(x => x.id === action.id) || PRESETS[0];
      return { ...state, activePuzzle: pz, entries:{}, sel: firstSel(pz),
        config: { ...state.config, puzzleId:pz.id, puzzleName:pz.name } };
    }
    case 'ADD_PUZZLE': {
      const pz = action.puzzle;
      return { ...state, customPuzzles:[pz, ...state.customPuzzles.filter(p=>p.id!==pz.id)],
        activePuzzle: pz, entries:{}, sel: firstSel(pz),
        config: { ...state.config, puzzleId:pz.id, puzzleName:pz.name } };
    }

    case 'OPEN_LOBBY': {
      const bots = ROSTER.map((r,i) => makeBot(r,i,state.config.durationSec));
      return { ...state, phase:'lobby', players: bots, you:null, entries:{},
        lastJoinMs: Date.now(), prizeGiven:false, paused:false, pausedAccumMs:0 };
    }
    case 'BOT_JOIN': {
      const next = state.players.find(p => !p.joined && !p.isYou);
      if (!next) return state;
      return { ...state,
        players: state.players.map(p => p.id===next.id ? { ...p, joined:true, joinAt:Date.now() } : p),
        lastJoinMs: Date.now() };
    }
    case 'YOU_JOIN': {
      const you = { id:'you', name:action.name, isYou:true, joined:true, joinAt:Date.now(),
        finishTarget:null, hintsUsed:0, wrongAttempts:0, progress:0, finishMs:null, connected:true };
      return { ...state, you, players:[...state.players.filter(p=>p.id!=='you'), you] };
    }

    case 'START_COUNTDOWN': return { ...state, phase:'countdown', countdownFrom:3 };
    case 'TICK_COUNTDOWN': {
      if (state.countdownFrom <= 1) return { ...state, phase:'live', startedAt:Date.now(), pausedAccumMs:0 };
      return { ...state, countdownFrom: state.countdownFrom - 1 };
    }

    case 'TICK': {
      const now = Date.now();
      let st = { ...state, nowMs: now };
      // lobby: trickle bots in
      if (state.phase === 'lobby') {
        const joinedCount = state.players.filter(p=>p.joined).length;
        if (joinedCount < 8 && now - state.lastJoinMs > 1400) {
          return reducer(st, { type:'BOT_JOIN' });
        }
        return st;
      }
      // live: advance bots
      if (state.phase === 'live' && !state.paused && state.startedAt) {
        const elapsed = (now - state.startedAt - state.pausedAccumMs) / 1000;
        const players = state.players.map(p => {
          if (p.isYou || !p.joined) return p;
          if (p.finishMs != null) return p;
          const t = Math.min(1, elapsed / p.finishTarget);
          const progress = Math.min(0.99, t * 0.99 + (t>=1?0.01:0));
          const hintsUsed = Math.round(p.plannedHints * Math.min(1, t*1.2));
          const wrongAttempts = Math.round(p.plannedWrong * Math.min(1, t*1.1));
          let finishMs = null, prog = progress;
          if (elapsed >= p.finishTarget && p.finishTarget <= state.config.durationSec) {
            finishMs = p.finishTarget * 1000; prog = 1;
          }
          return { ...p, progress:prog, hintsUsed, wrongAttempts, finishMs };
        });
        return { ...st, players };
      }
      return st;
    }

    case 'SELECT': {
      const { r, c } = action;
      const pz = state.activePuzzle;
      if (pIsBlock(pz,r,c)) return state;
      let dir;
      if (state.sel.r === r && state.sel.c === c) {
        const other = state.sel.dir==='across'?'down':'across';
        dir = pDirFor(pz,r,c,other);
      } else dir = pDirFor(pz,r,c,state.sel.dir);
      return { ...state, sel:{ r, c, dir } };
    }
    case 'SET_DIR': {
      const { r, c } = state.sel;
      return { ...state, sel:{ ...state.sel, dir: pDirFor(state.activePuzzle,r,c,action.dir) } };
    }

    case 'TYPE': {
      const pz = state.activePuzzle;
      const { r, c } = state.sel;
      if (pIsBlock(pz,r,c)) return state;
      const entries = { ...state.entries, [`${r},${c}`]: action.letter };
      const next = pStep(pz, r, c, state.sel.dir, +1);
      const youProg = pProgress(pz, entries);
      const you = state.you ? { ...state.you, progress:youProg } : state.you;
      return { ...state, entries, sel:{ ...state.sel, r:next.r, c:next.c },
        you, players: state.players.map(p=>p.isYou? { ...p, progress:youProg }:p) };
    }
    case 'BACKSPACE': {
      const pz = state.activePuzzle;
      const { r, c } = state.sel;
      const key = `${r},${c}`;
      let entries = { ...state.entries };
      let sel = state.sel;
      if (entries[key]) { delete entries[key]; }
      else {
        const prev = pStep(pz, r, c, state.sel.dir, -1);
        delete entries[`${prev.r},${prev.c}`];
        sel = { ...state.sel, r:prev.r, c:prev.c };
      }
      const youProg = pProgress(pz, entries);
      return { ...state, entries, sel,
        you: state.you?{...state.you, progress:youProg}:state.you,
        players: state.players.map(p=>p.isYou?{...p,progress:youProg}:p) };
    }
    case 'USE_HINT': {
      const pz = state.activePuzzle;
      const { r, c } = action;
      const entries = { ...state.entries, [`${r},${c}`]: pz.grid[r][c] };
      const hintsUsed = (state.you?.hintsUsed||0) + 1;
      const youProg = pProgress(pz, entries);
      const you = { ...state.you, hintsUsed, progress:youProg };
      return { ...state, entries, you,
        players: state.players.map(p=>p.isYou?you:p) };
    }
    case 'WRONG': {
      const wrongAttempts = (state.you?.wrongAttempts||0)+1;
      const you = { ...state.you, wrongAttempts };
      return { ...state, you, players: state.players.map(p=>p.isYou?you:p) };
    }
    case 'YOU_FINISH': {
      const elapsed = state.startedAt ? (Date.now()-state.startedAt-state.pausedAccumMs) : 60000;
      const you = { ...state.you, finishMs: action.ms ?? elapsed, progress:1 };
      return { ...state, you, players: state.players.map(p=>p.isYou?you:p) };
    }

    case 'PAUSE_TOGGLE': {
      if (state.paused) {
        return { ...state, paused:false, pausedAccumMs: state.pausedAccumMs + (Date.now()-state.pausedAt) };
      }
      return { ...state, paused:true, pausedAt: Date.now() };
    }
    case 'TOGGLE_LB': return { ...state, showLeaderboard: !state.showLeaderboard };
    case 'END_ROUND': return { ...state, phase:'winner', paused:false };
    case 'MARK_PRIZE': return { ...state, prizeGiven:true };
    case 'NEXT_ROUND': {
      return { ...initState(), phase:'setup', round: state.round+1, joinCode: nextCode(state.joinCode),
        config: state.config, activePuzzle: state.activePuzzle, customPuzzles: state.customPuzzles,
        sel: firstSel(state.activePuzzle),
        history: { ...state.history, rounds: state.history.rounds+1 } };
    }
    case 'RESET': return { ...initState() };
    default: return state;
  }
}

function nextCode(code) {
  const n = Math.floor(Math.random()*900+100);
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return `${L[Math.floor(Math.random()*L.length)]}${L[Math.floor(Math.random()*L.length)]}${L[Math.floor(Math.random()*L.length)]}-${n}`;
}

// ---------- helpers exposed to UI ----------
function rankedPlayers(state) {
  const cfg = state.config;
  const withScore = state.players.filter(p=>p.joined).map(p => ({ ...p, score: scoreFor(p, cfg) }));
  withScore.sort((a,b) => {
    const af = a.finishMs!=null, bf = b.finishMs!=null;
    if (af && bf) return a.score.adj - b.score.adj;
    if (af) return -1; if (bf) return 1;
    return b.progress - a.progress;
  });
  return withScore;
}
function liveElapsed(state) {
  if (!state.startedAt) return 0;
  const end = state.paused ? state.pausedAt : state.nowMs;
  return Math.max(0, (end - state.startedAt - state.pausedAccumMs) / 1000);
}
function liveRemaining(state) {
  return Math.max(0, state.config.durationSec - liveElapsed(state));
}
function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec/60), s = sec%60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

// ---------- context ----------
const GameCtx = createContext(null);
function useGame() { return useContext(GameCtx); }

function GameProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);

  // master clock
  useEffect(() => {
    const id = setInterval(() => dispatch({ type:'TICK' }), 1000);
    return () => clearInterval(id);
  }, []);

  // countdown ticker
  useEffect(() => {
    if (state.phase !== 'countdown') return;
    const id = setTimeout(() => dispatch({ type:'TICK_COUNTDOWN' }), 1000);
    return () => clearTimeout(id);
  }, [state.phase, state.countdownFrom]);

  // auto-end when live timer expires
  useEffect(() => {
    if (state.phase === 'live' && !state.paused && liveRemaining(state) <= 0 && state.startedAt) {
      dispatch({ type:'END_ROUND' });
    }
  }, [state.nowMs, state.phase, state.paused]);

  return <GameCtx.Provider value={{ state, dispatch }}>{children}</GameCtx.Provider>;
}

Object.assign(window, {
  GameProvider, useGame,
  EVENT, EVENTS,
  buildPuzzle, generatePuzzle, PRESETS,
  pIsBlock, pWordAt, pDirFor, pStep, pProgress, firstSel,
  DIFFICULTIES, PUZZLES, ROSTER,
  scoreFor, rankedPlayers, liveElapsed, liveRemaining, fmtTime,
});
