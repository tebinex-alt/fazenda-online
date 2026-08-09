/* =========================================================
   SISTEMA DE SOM (SFX) — síntese WebAudio pura
   Zero assets: todos os sons são osciladores + envelopes de
   ganho gerados em runtime. Funciona offline.

   Regras:
   - O AudioContext só é criado no PRIMEIRO gesto do usuário
     (pointerdown/keydown). Antes disso todo play() é no-op —
     nada toca nem gera erro (seguro p/ harness headless).
   - Mudo persistido em Storage (mesmo wrapper do multiplayer).
   - Botão mudo #sfx-toggle no topbar (DOM estático, bind aqui).
========================================================= */
(function(){
"use strict";

const MASTER_VOL = 0.35;
let ctx = null;
let master = null;
let muted = false;

function available(){
  return typeof (window.AudioContext || window.webkitAudioContext) !== 'undefined';
}

function ensure(){
  if(!available()) return null;
  if(ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  try{
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOL;
    master.connect(ctx.destination);
  }catch(e){
    ctx = null; master = null;
  }
  return ctx;
}

/* Desbloqueio por gesto: cria/resume o contexto no primeiro
   clique/tecla — a política de autoplay exige isso. */
function unlock(){
  if(!available()) return;
  const c = ensure();
  if(c && c.state === 'suspended'){ c.resume().catch(function(){}); }
}
if(typeof document !== 'undefined'){
  var EVS = ['pointerdown','keydown','touchstart'];
  var tryUnlock = function(){
    unlock();
    EVS.forEach(function(e){ document.removeEventListener(e, tryUnlock); });
  };
  EVS.forEach(function(e){ document.addEventListener(e, tryUnlock, { once:true }); });
}

/* Tom simples: oscilador + envelope. freq→glideTo (opcional). */
function tone(freq, dur, type, vol, when, glideTo){
  if(!ctx || !master || muted) return;
  const t0 = ctx.currentTime + (when||0);
  const osc = ctx.createOscillator();
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(Math.max(30, freq), t0);
  if(glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, glideTo), t0+dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0+dur+0.02);
}

/* Ruído branco filtrado (impactos/socos). */
function noiseBurst(dur, vol, when, cutoff){
  if(!ctx || !master || muted) return;
  const t0 = ctx.currentTime + (when||0);
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for(let i=0;i<len;i++) data[i] = Math.random()*2-1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff || 800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0+dur+0.02);
}

/* --- Sons do jogo --- */
function hit(){
  const v = 0.4 + Math.random()*0.15;             // pequena variação p/ não enjoar
  tone(180, 0.11, 'square', v, 0, 90);            // soco grave
  noiseBurst(0.06, v*0.5, 0, 700);                // tranco seco
}
function crit(){
  tone(640, 0.14, 'square', 0.4, 0, 900);         // agudo cortante
  tone(960, 0.10, 'sawtooth', 0.2, 0.02, 1200);
  noiseBurst(0.05, 0.25, 0, 1500);
}
function evade(){
  tone(240, 0.14, 'sine', 0.28, 0, 760);          // whoosh ascendente
}
function ko(){
  tone(160, 0.38, 'sawtooth', 0.5, 0, 40);        // queda grave
  noiseBurst(0.22, 0.45, 0, 320);                 // thud
}
function victory(){
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6 — arpejo maior
  notes.forEach((f,i)=> tone(f, 0.22, 'square', 0.22, i*0.11));
}
function defeat(){
  const notes = [392.0, 329.63, 261.63, 196.0];   // G4 E4 C4 G3 — arpejo menor desc.
  notes.forEach((f,i)=> tone(f, 0.26, 'sine', 0.24, i*0.15));
}
function coin(){
  tone(880, 0.07, 'square', 0.28);
  tone(1318.5, 0.16, 'square', 0.22, 0.06);
}
function ui(){
  tone(600, 0.06, 'sine', 0.18);
}

/* --- Mudo --- */
function isMuted(){ return muted; }
function setMuted(m){
  muted = !!m;
  if(master) master.gain.value = muted ? 0 : MASTER_VOL;
  try{ Storage.set('sfx-muted', muted ? '1' : '0', false); }catch(e){}
  updateToggleBtn();
}
function toggle(){
  setMuted(!muted);
  return muted;
}
function updateToggleBtn(){
  const btn = document && document.getElementById('sfx-toggle');
  if(!btn) return;
  btn.textContent = muted ? '🔇' : '🔊';
  btn.title = muted ? 'Som desligado (clique p/ ligar)' : 'Som ligado (clique p/ desligar)';
}

/* Init: lê o estado de mudo salvo (assíncrono) e amarra o botão. */
if(typeof document !== 'undefined'){
  const btn = document.getElementById('sfx-toggle');
  if(btn) btn.addEventListener('click', ()=>{ toggle(); if(!muted) ui(); });
  updateToggleBtn();
  if(typeof Storage !== 'undefined' && Storage.get){
    Storage.get('sfx-muted', false).then(r=>{
      if(r && r.value === '1' && !muted) setMuted(true);
    }).catch(()=>{});
  }
}

window.SFX = {
  available,
  hit, crit, evade, ko, victory, defeat, coin, ui,
  isMuted, setMuted, toggle,
  /* para o harness headless: estado do AudioContext (null = sem gesto ainda) */
  _debug(){ return ctx; },
};

})();
