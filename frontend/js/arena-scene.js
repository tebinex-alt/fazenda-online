/* =========================================================
   CENA DA ARENA — combate pixel-art animado (PixiJS)
   ---------------------------------------------------------
   Dois galos procedurais lutam em playback fiel do resultado
   PRÉ-ROLADO por Combat.simulateFight(fA, fB): a animação é
   pura encenação (nunca decide quem vence). Fases:
   1. Entrada (~0.8s)   — galos entram em diagonal + poeira
   2. VS reveal (~0.7s) — banner "VS" cresce + shake
   3. Rounds (6-12)     — lunge, hit flash, dano flutuante,
                          crítico/esquiva, knockback, barras
   4. KO (~0.6s)        — perdedor cai + poeira, "K.O.!"
   5. Resultado (~0.9s) — banner "🏆 VITÓRIA!"/"💔 DERROTA"

   NOTA: PIXI é carregado por CDN ASSÍNCRONA, então pode estar
   undefined no eval deste arquivo. A guarda fica no wrapper
   ArenaScene (available/mount/play), nunca no topo do IIFE.
========================================================= */
window.ArenaScene = (function(){
  "use strict";

  // Paleta de plumagem por raça (ids de config.js FIGHT_BREEDS_TYPES).
  // Tons escolhidos com alto contraste contra o palco marrom e entre si.
  const BREED_PALETTE = {
    shamo:'#6FA05A',   // verde-oliva (caule de batalha clássico)
    indio:'#C85B2E',   // ruivo acobreado (bater de espora)
    ingles:'#4A6B9C',  // azul-aço
    calcuta:'#B0893F', // dourado-areia
    barbudo:'#8A4E3C', // castanho-barbado
  };
  const BREED_FALLBACK = '#8A7A66'; // raça desconhecida
  const COMB_RED = '#D64541';
  const BEAK_YELLOW = '#E8A93A';
  const LEG_COLOR = '#D8A24A';

  let scene = null;       // cena ativa (estado interno, não PIXI Application)
  let containerEl = null;

  /* ---------------- utilitários (espelham scene-iso.js) ---------------- */
  function newG(){ return new PIXI.Graphics(); }
  function hexNum(h){ return parseInt(h.slice(1),16); }
  function toTexture(app, g, w, h){
    const rt = PIXI.RenderTexture.create({width:Math.max(1,w), height:Math.max(1,h), resolution:2});
    app.renderer.render(g, {renderTexture:rt});
    rt.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
    g.destroy();
    return rt;
  }
  function drawRectBlocks(g, wBlocks, hBlocks, block, colorFn, offX=0, offY=0){
    for(let by=0; by<hBlocks; by++){
      for(let bx=0; bx<wBlocks; bx++){
        const c = colorFn(bx,by,wBlocks,hBlocks);
        if(c===null || c===undefined) continue;
        g.beginFill(c);
        g.drawRect(offX+bx*block, offY+by*block, block, block);
        g.endFill();
      }
    }
  }
  function seeded(i){ let x=Math.sin(i*999.7)*10000; return x-Math.floor(x); }
  function darken(hex, amt){
    return Math.max(0, hexNum(hex) - amt);
  }
  function lighten(hex, amt){
    return Math.min(0xFFFFFF, hexNum(hex) + amt);
  }

  /* ---------------- galo pixel-art procedural (24x22 blocos) ----------------
     Perfil virado para a direita, pose de combate: cauda empinada em leque,
     peito erguido, asa em relevo, esporão. Ordem de desenho = ordem de
     prioridade (o primeiro match vence): pernas → corpo → pescoço/cabeça →
     detalhes da cabeça → cauda por cima (leque erguido atrás). */
  function buildRoosterTexture(app, plumage){
    const B = 3;                 // tamanho do pixel lógico
    const wBlk = 24, hBlk = 22;
    const g = newG();
    const p = hexNum(plumage);
    const pDark   = darken(plumage, 0x383838); // penas médias
    const pDark2  = darken(plumage, 0x555555); // penas escuras (cauda/asa)
    const pLight  = lighten(plumage, 0x242424); // luz do topo
    const pLighter= lighten(plumage, 0x484848); // reflexo
    const belly   = lighten(plumage, 0x565656); // peito claro
    const comb    = hexNum(COMB_RED);
    const combDark= darken(COMB_RED, 0x262626);
    const beak    = hexNum(BEAK_YELLOW);
    const beakDark= darken(BEAK_YELLOW, 0x323232);
    const leg     = hexNum(LEG_COLOR);
    const legDark = darken(LEG_COLOR, 0x353535);
    const eye     = hexNum('#161616');
    const eyeGlint= hexNum('#FFF8E0');

    drawRectBlocks(g, wBlk, hBlk, B, (bx,by)=>{

      /* ---------- PERNAS (amarelas) ---------- */
      if(by>=17 && by<=20 && bx>=8 && bx<=9) return leg;
      if(by>=17 && by<=20 && bx>=13 && bx<=14) return leg;
      // pés (dedos abertos)
      if(by===21 && bx>=7 && bx<=10) return leg;
      if(by===21 && bx>=12 && bx<=15) return leg;
      // esporão (atrás da perna de trás)
      if(by>=17 && by<=18 && bx===7) return legDark;
      // sombra na perna
      if(by===20 && bx===14) return legDark;

      /* ---------- CORPO (tronco oval, peito alto) ---------- */
      if(by===9  && bx>=6  && bx<=13) return p;
      if(by===10 && bx>=5  && bx<=15) return p;
      if(by===11 && bx>=5  && bx<=16) return p;
      if(by===12 && bx>=5  && bx<=16) return p;
      if(by===13 && bx>=5  && bx<=16) return p;
      if(by===14 && bx>=5  && bx<=16) return p;
      if(by===15 && bx>=6  && bx<=15) return p;
      if(by===16 && bx>=7  && bx<=14) return p;
      if(by===17 && bx>=8  && bx<=13) return p;

      // luz no topo das costas
      if(by===9 && bx>=6 && bx<=11) return pLight;
      if(by===10 && bx>=5 && bx<=8) return pLight;
      // peito claro (frente)
      if(by>=10 && by<=14 && bx>=5 && bx<=8) return belly;
      if(by>=11 && by<=13 && bx>=6 && bx<=9) return belly;
      // sombra na barriga/traseira
      if(by===14 && bx>=13 && bx<=16) return pDark;
      if(by===15 && bx>=12 && bx<=15) return pDark;
      if(by===16 && bx>=11 && bx<=14) return pDark;
      if(by===17 && bx>=8 && bx<=13) return pDark;

      /* ---------- ASA (relevo no flanco) ---------- */
      if(by===11 && bx>=8  && bx<=11) return pDark2;
      if(by===12 && bx>=7  && bx<=12) return pDark2;
      if(by===13 && bx>=7  && bx<=11) return pDark2;
      if(by===14 && bx>=8  && bx<=10) return pDark;
      // borda iluminada da asa
      if(by===11 && bx===12) return pLighter;
      if(by===12 && bx===13) return pLighter;
      if(by===13 && bx===12) return pLighter;

      /* ---------- CABEÇA ---------- */
      if(by===3 && bx>=14 && bx<=19) return p;
      if(by===4 && bx>=13 && bx<=19) return p;
      if(by===5 && bx>=13 && bx<=19) return p;
      if(by===6 && bx>=13 && bx<=19) return p;
      if(by===7 && bx>=14 && bx<=18) return p;
      if(by===3 && bx>=15 && bx<=17) return pLight;

      /* ---------- PESCOÇO (grosso, liga cabeça ao corpo) ---------- */
      if(by===6 && bx>=11 && bx<=14) return p;
      if(by===7 && bx>=10 && bx<=15) return p;
      if(by===8 && bx>=9  && bx<=15) return p;
      if(by===7 && bx>=13 && bx<=14) return pLighter;
      if(by===8 && bx>=12 && bx<=14) return pLighter;

      /* ---------- OLHO (com brilho) ---------- */
      if(by===5 && bx===17) return eye;
      if(by===5 && bx===18) return eyeGlint;

      /* ---------- BICO (afiado, com abertura) ---------- */
      if(by===4 && bx>=20 && bx<=21) return beak;
      if(by===5 && bx>=20 && bx<=22) return beak;
      if(by===6 && bx>=21 && bx<=22) return beak;
      if(by===5 && bx>=20 && bx<=21) return beakDark;
      if(by===6 && bx===22) return beakDark;

      /* ---------- PENTE (3 dentes vermelhos) ---------- */
      if(by===0 && bx>=16 && bx<=17) return comb;
      if(by===1 && bx>=15 && bx<=18) return comb;
      if(by===2 && bx>=14 && bx<=19) return comb;
      if(by===2 && bx>=18 && bx<=19) return combDark;

      /* ---------- BARBELA (papada vermelha) ---------- */
      if(by===7 && bx>=18 && bx<=19) return comb;
      if(by===8 && bx>=17 && bx<=19) return comb;

      /* ---------- CAUDA — leque erguido atrás (por cima do corpo) ---------- */
      if(by===2 && bx>=0 && bx<=1) return pDark2;
      if(by===3 && bx>=0 && bx<=2) return pDark2;
      if(by===4 && bx>=0 && bx<=3) return pDark2;
      if(by===5 && bx>=0 && bx<=4) return pDark2;
      if(by===6 && bx>=1 && bx<=5) return pDark2;
      if(by===7 && bx>=1 && bx<=6) return pDark2;
      if(by===8 && bx>=2 && bx<=7) return pDark2;
      if(by===9 && bx>=3 && bx<=8) return pDark2;
      if(by===10 && bx>=4 && bx<=9) return pDark2;
      if(by===11 && bx>=5 && bx<=9) return pDark;
      if(by===12 && bx>=6 && bx<=9) return pDark;
      // penas com pontas claras (reflexo, define as penas do leque)
      if(by===3 && bx===0) return p;
      if(by===4 && bx===1) return p;
      if(by===5 && bx===2) return pLight;
      if(by===6 && bx===3) return p;
      if(by===7 && bx===4) return pLight;
      if(by===8 && bx===5) return p;
      if(by===9 && bx===6) return pLight;
      if(by===10 && bx===7) return p;

      return null;
    });
    return toTexture(app, g, wBlk*B, hBlk*B);
  }

  /* ---------------- poeira (puffs de fumaça) ---------------- */
  function buildPuffTexture(app){
    const B = 3, wBlk = 8, hBlk = 5;
    const g = newG();
    drawRectBlocks(g, wBlk, hBlk, B, (bx,by)=>{
      const nx = (bx-3.5)/4, ny = (by-2)/2.4;
      return (nx*nx + ny*ny <= 1) ? hexNum('#D8C9A8') : null;
    });
    return toTexture(app, g, wBlk*B, hBlk*B);
  }

  /* ---------------- estrela (brilho de crítico/explosão) ---------------- */
  function buildSparkTexture(app){
    const B = 3, wBlk = 5, hBlk = 5;
    const g = newG();
    drawRectBlocks(g, wBlk, hBlk, B, (bx,by)=>{
      if(bx===2 || by===2) return hexNum('#FFF3C4');
      return null;
    });
    return toTexture(app, g, wBlk*B, hBlk*B);
  }

  /* =========================================================
     INTERNA — estado e fases da animação
  ========================================================= */
  function state(){ return scene; }

  // Cria (ou reconstrói) a cena PIXI dentro do contêiner.
  function _ensureApp(){
    if(scene && scene.app) return true;
    if(typeof PIXI === 'undefined' || !containerEl) return false;
    const app = new PIXI.Application({
      resizeTo: containerEl,
      backgroundAlpha: 1,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio||1),
    });
    containerEl.appendChild(app.view);
    app.view.style.position='absolute';
    app.view.style.inset='0';
    app.view.style.width='100%';
    app.view.style.height='100%';
    PIXI.settings.ROUND_PIXELS = true;
    PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST;
    scene = {
      app,
      root: new PIXI.Container(),       // shake: posição oscila em hits fortes
      ground: new PIXI.Container(),
      fighters: new PIXI.Container(),
      fx: new PIXI.Container(),
      phase: 'idle',
      phaseT: 0,
      fightersData: null,
      fight: null,
      callbacks: null,
      roundIdx: 0,
      hp: { a:0, b:0 },
      hpStart: { a:0, b:0 },
      hitmarks: [],
      puffs: [],
      sparks: [],
      vs: null,
      koText: null,
      resultBanner: null,
      labelA: null, labelB: null,
      barA: null, barB: null,
      barFillA: null, barFillB: null,
      bobT: 0,
    };
    app.stage.addChild(scene.root);
    scene.root.addChild(scene.ground, scene.fighters, scene.fx);
    app.ticker.add((delta)=> _tick(scene, delta));
    return true;
  }

  // Desenha o fundo (arena de madeira/terra) e os dois galos.
  function _buildWorld(fA, fB){
    const s = scene;
    // fundo: degrade de terra + palco circular de madeira
    const bg = new PIXI.Graphics();
    bg.beginFill(hexNum('#2A2620'));
    bg.drawRect(0, 0, s.app.renderer.width/s.app.renderer.resolution, s.app.renderer.height/s.app.renderer.resolution);
    bg.endFill();
    s.ground.addChild(bg);
    const stageW = Math.min(560, s.app.renderer.width/s.app.renderer.resolution - 40);
    const platform = new PIXI.Graphics();
    platform.beginFill(hexNum('#3E3226'));
    platform.drawRoundedRect((s.app.renderer.width/s.app.renderer.resolution - stageW)/2, (s.app.renderer.height/s.app.renderer.resolution)*0.62, stageW, 90, 8);
    platform.endFill();
    platform.beginFill(hexNum('#5A4632'));
    platform.drawRoundedRect((s.app.renderer.width/s.app.renderer.resolution - stageW)/2, (s.app.renderer.height/s.app.renderer.resolution)*0.62, stageW, 12, 4);
    platform.endFill();
    s.ground.addChild(platform);

    // galos
    const texA = buildRoosterTexture(s.app, BREED_PALETTE[fA.breedType] || BREED_FALLBACK);
    const texB = buildRoosterTexture(s.app, BREED_PALETTE[fB.breedType] || BREED_FALLBACK);
    s.galoA = new PIXI.Sprite(texA);
    s.galoB = new PIXI.Sprite(texB);
    s.galoA.anchor.set(0.5,1);
    s.galoB.anchor.set(0.5,1);
    const gy = (s.app.renderer.height/s.app.renderer.resolution)*0.78;
    const gx = (s.app.renderer.width/s.app.renderer.resolution)/2;
    s.galoA.x = gx - 90; s.galoA.y = gy; s.galoA.scale.set(2.4);
    s.galoB.x = gx + 90; s.galoB.y = gy; s.galoB.scale.set(2.4);
    s.galoB.scale.x *= -1; // vira pra esquerda
    s.fighters.addChild(s.galoA, s.galoB);

    // etiquetas (nomes) e barras de vida no topo.
    // _mkLabel retorna ELEMENTO DOM (já anexado ao container) — NÃO entra na
    // hierarquia PIXI (addChild de elemento HTML quebra o motor internamente).
    const labelA = _mkLabel(fA.name || 'Você', '#FFD166');
    const labelB = _mkLabel(fB.name || 'Oponente', '#FF8C7A');
    s.labelA = labelA; s.labelB = labelB;
    _placeTopHUD();
  }

  function _mkLabel(text, color){
    const el = document.createElement('div');
    el.className = 'arena-hud-label';
    el.style.color = color;
    el.textContent = text;
    containerEl.appendChild(el);
    return el;
  }

  // Remove TODOS os elementos DOM efêmeros da cena anexados ao container.
  // Cada luta reconstrói o HUD do zero; sem isso labels/barras antigas
  // empilham por cima das novas (o bug da "barra que aparece na próxima cena").
  function _clearHud(){
    if(!containerEl) return;
    containerEl.querySelectorAll(
      '.arena-hud-label, .arena-bar, .arena-float, .arena-vs, .arena-ko, .arena-result-banner, .arena-continue-btn'
    ).forEach(el=>el.remove());
  }

  function _placeTopHUD(){
    const s = scene;
    if(!s.labelA || !s.labelB) return;
    const w = containerEl.clientWidth || 600;
    const pad = 12;
    const labelH = 16;
    const barH = 10;
    // etiquetas centralizadas sobre a barra de cada lado
    s.labelA.style.left = (pad) + 'px';
    s.labelA.style.top = (pad) + 'px';
    s.labelB.style.right = (pad) + 'px';
    s.labelB.style.top = (pad) + 'px';
    const barA = _ensureBar('arena-bar-a', pad, pad+labelH+2, w*0.40, barH, '#E8A93A');
    const barB = _ensureBar('arena-bar-b', w - pad - w*0.40, pad+labelH+2, w*0.40, barH, '#B4552D');
    s.barA = barA; s.barB = barB;
    s.barFillA = barA.querySelector('.arena-bar-fill');
    s.barFillB = barB.querySelector('.arena-bar-fill');
    _setBar(s.barFillA, 1); _setBar(s.barFillB, 1);
  }

  function _ensureBar(id, left, top, width, height, color){
    let el = containerEl.querySelector('#'+id);
    if(!el){
      el = document.createElement('div');
      el.id = id;
      el.className = 'arena-bar';
      const fill = document.createElement('div');
      fill.className = 'arena-bar-fill';
      fill.style.background = color;
      el.appendChild(fill);
      containerEl.appendChild(el);
    }
    el.style.left = left+'px';
    el.style.top = top+'px';
    el.style.width = width+'px';
    el.style.height = height+'px';
    return el;
  }

  function _setBar(fill, ratio){
    if(!fill) return;
    ratio = Math.max(0, Math.min(1, ratio));
    fill.style.width = (ratio*100) + '%';
    // cor muda de verde → âmbar → vermelho conforme perde vida
    if(ratio > 0.5) fill.style.background = '#6FBF73';
    else if(ratio > 0.25) fill.style.background = '#E8A93A';
    else fill.style.background = '#D64541';
  }

  // Texto flutuante de dano (sobe + fade, removido após ~600ms)
  function _floatingText(text, x, y, cls){
    const el = document.createElement('div');
    el.className = 'arena-float '+ (cls||'');
    el.textContent = text;
    el.style.left = x+'px';
    el.style.top = y+'px';
    containerEl.appendChild(el);
    scene.floats.push(el);
    // sobe e some
    setTimeout(()=>{
      el.classList.add('arena-float-out');
      setTimeout(()=>{ if(el.parentNode) el.parentNode.removeChild(el); }, 700);
    }, 60);
  }

  // Puff de poeira no chão
  function _puff(x, y, scale){
    const spr = new PIXI.Sprite(scene.T.puff);
    spr.anchor.set(0.5,1);
    spr.x = x; spr.y = y;
    spr.scale.set(scale);
    spr.alpha = 0;
    scene.fx.addChild(spr);
    scene.puffs.push(spr);
  }

  // Brilho de impacto (crítico/explosão)
  function _spark(x, y, scale){
    const spr = new PIXI.Sprite(scene.T.spark);
    spr.anchor.set(0.5);
    spr.x = x; spr.y = y;
    spr.scale.set(scale);
    spr.alpha = 0;
    scene.fx.addChild(spr);
    scene.sparks.push(spr);
  }

  /* ---------------- loop de fases ---------------- */
  function _tick(s, delta){
    const dt = Math.min(0.05, delta/60);   // segundos, clamp pra não pular em tab-switch
    s.phaseT += dt;
    // galos "respiram" (bob) mesmo parados
    s.bobT += dt;
    const bobA = Math.sin(s.bobT*3)*2;
    const bobB = Math.sin(s.bobT*3+1.4)*2;
    if(s.galoA){ s.galoA.y = s.baseY + bobA; }
    if(s.galoB){ s.galoB.y = s.baseY + bobB; }

    // atualiza partículas
    for(let i=s.puffs.length-1; i>=0; i--){
      const p = s.puffs[i];
      p.alpha += dt*1.5;
      p.y -= dt*18;
      p.x += dt*10;
      p.scale.x += dt*0.6; p.scale.y += dt*0.6;
      if(p.alpha >= 1){ s.puffs.splice(i,1); p.destroy(); }
    }
    for(let i=s.sparks.length-1; i>=0; i--){
      const sp = s.sparks[i];
      sp.alpha += dt*2;
      sp.scale.x += dt*1.2; sp.scale.y += dt*1.2;
      sp.rotation += dt*2;
      if(sp.alpha >= 1){ s.sparks.splice(i,1); sp.destroy(); }
    }

    switch(s.phase){
      case 'enter': _tickEnter(s, dt); break;
      case 'vs':    _tickVs(s, dt); break;
      case 'rounds':_tickRounds(s, dt); break;
      case 'ko':    _tickKo(s, dt); break;
      case 'result':_tickResult(s, dt); break;
    }
  }

  function _tickEnter(s, dt){
    const DUR = 0.8;
    const t = Math.min(1, s.phaseT / DUR);
    // galos entram de fora (a partir dos cantos) até suas posições
    const gx = (s.app.renderer.width/s.app.renderer.resolution)/2;
    s.galoA.x = (gx - 90) * t + (s.enterXA0) * (1-t);
    s.galoB.x = (gx + 90) * t + (s.enterXB0) * (1-t);
    // poeira nos primeiros 300ms
    if(s.phaseT < 0.3 && Math.random() < 0.5){
      _puff(s.galoA.x + 6, s.baseY, 0.4+Math.random()*0.3);
      _puff(s.galoB.x - 6, s.baseY, 0.4+Math.random()*0.3);
    }
    if(t >= 1){ s.phase = 'vs'; s.phaseT = 0; _showVs(); }
  }

  function _showVs(){
    const s = scene;
    const el = document.createElement('div');
    el.className = 'arena-vs';
    el.textContent = 'VS';
    containerEl.appendChild(el);
    s.vs = el;
  }

  function _tickVs(s, dt){
    const DUR = 0.7;
    const t = Math.min(1, s.phaseT / DUR);
    if(s.vs){
      s.vs.style.transform = 'translate(-50%,-50%) scale('+ (0.4 + t*0.7) +')';
      s.vs.style.opacity = String(t);
    }
    if(s.phaseT >= DUR){ s.phase = 'rounds'; s.phaseT = 0; _startRounds(); }
  }

  function _startRounds(){
    const s = scene;
    if(s.vs){
      s.vs.style.transition = 'opacity 0.2s';
      s.vs.style.opacity = '0';
      setTimeout(()=>{ if(s.vs && s.vs.parentNode) s.vs.parentNode.removeChild(s.vs); s.vs=null; }, 220);
    }
  }

  function _tickRounds(s, dt){
    const round = s.fight.rounds[s.roundIdx];
    if(!round) { s.phase = 'ko'; s.phaseT = 0; _startKo(); return; }
    // cada round dura ~380ms
    const ROUND_DUR = 0.38;
    const t = Math.min(1, s.phaseT / ROUND_DUR);
    const attacker = round.attacker === 'a' ? s.galoA : s.galoB;
    const defender = round.attacker === 'a' ? s.galoB : s.galoA;
    const atkIsA = round.attacker === 'a';
    // lunge: atacante avança até o meio, volta
    const dir = atkIsA ? 1 : -1;
    const lungX = dir * 34 * Math.sin(t*Math.PI);
    attacker.x = s.baseX[round.attacker] + lungX;
    // flash de impacto no meio da animação
    if(!s._hitFlashDone && t >= 0.45){
      s._hitFlashDone = true;
      const hitX = attacker.x + dir*10;
      const hitY = attacker.y - 30;
      if(round.evaded){
        _floatingText('ESQUIVOU!', hitX-20, hitY-10, 'arena-float-evade');
        if(window.SFX && SFX.available()) SFX.evade();
      } else {
        if(window.SFX && SFX.available()){ if(round.crit) SFX.crit(); else SFX.hit(); }
        if(round.crit) _floatingText('CRÍTICO! '+round.dmg, hitX-20, hitY-10, 'arena-float-crit');
        else _floatingText('-'+round.dmg, hitX-14, hitY-10, 'arena-float-dmg');
        _spark(hitX, hitY, 0.8);
        if(round.crit){ _spark(hitX-10, hitY-8, 0.6); _spark(hitX+10, hitY+4, 0.5); }
      }
      // drena a barra do defensor (playback fiel: subtrai o dano primeiro,
      // depois atualiza a barra — assim o golpe e a drenagem acontecem juntos)
      const def = round.attacker === 'a' ? 'b' : 'a';
      if(!round.evaded){
        s.hp[def] = Math.max(0, s.hp[def] - round.dmg);
      }
      _setBar(def==='a'?s.barFillA:s.barFillB, s.hp[def]/s.hpStart[def]);
    }
    // knockback no defensor (empurrão suave)
    const kbDir = atkIsA ? -1 : 1;
    const kb = (t>=0.45 && !round.evaded) ? 14*Math.sin(Math.max(0,(t-0.45))*Math.PI/0.55) : 0;
    defender.x = s.baseX[defender===s.galoA?'a':'b'] + kbDir*kb;
    // shake no hit forte (crit)
    if(!s._shakeDone && t>=0.45 && (round.crit || round.dmg>=14)){
      s._shakeDone = true;
      _shake(s, 0.15, 3);
    }
    if(t >= 1){
      s.roundIdx++;
      s.phaseT = 0;
      s._hitFlashDone = false;
      s._shakeDone = false;
      // alinha os galos de volta
      attacker.x = s.baseX[round.attacker];
      defender.x = s.baseX[defender===s.galoA?'a':'b'];
    }
  }

  function _shake(s, dur, power){
    const start = Date.now();
    const origX = s.root.x;
    const timer = setInterval(()=>{
      const t = (Date.now()-start)/1000;
      if(t >= dur){ clearInterval(timer); s.root.x = origX; return; }
      s.root.x = origX + (Math.random()*2-1)*power;
    }, 16);
  }

  function _startKo(){
    const s = scene;
    const loser = s.fight.winner === 'a' ? 'b' : 'a';
    const loserSpr = loser === 'a' ? s.galoA : s.galoB;
    s.ko = { loser, t:0, dur:0.6 };
    // poeira da queda
    _puff(loserSpr.x, loserSpr.y, 1.2);
    _puff(loserSpr.x-14, loserSpr.y-6, 0.9);
    // texto K.O.
    const el = document.createElement('div');
    el.className = 'arena-ko';
    el.textContent = 'K.O.!';
    containerEl.appendChild(el);
    s.koText = el;
    if(window.SFX && SFX.available()) SFX.ko();
  }

  function _tickKo(s, dt){
    const ko = s.ko;
    if(!ko){ s.phase = 'result'; s.phaseT = 0; _startResult(); return; }
    ko.t += dt;
    const loserSpr = ko.loser === 'a' ? s.galoA : s.galoB;
    const t = Math.min(1, ko.t / ko.dur);
    // cai: rotaciona 90° e desce
    loserSpr.rotation = t * Math.PI/2 * (ko.loser==='a' ? -1 : 1);
    loserSpr.y = s.baseY + t*18;
    loserSpr.x = s.baseX[ko.loser] + t*10;
    if(s.koText){
      s.koText.style.transform = 'translate(-50%,-50%) scale('+ (0.5+t*0.8) +')';
      s.koText.style.opacity = String(t);
    }
    if(ko.t >= ko.dur){ s.phase = 'result'; s.phaseT = 0; _startResult(); }
  }

  function _startResult(){
    const s = scene;
    const won = s.fight.winner === 'a';
    const el = document.createElement('div');
    el.className = 'arena-result-banner ' + (won ? 'arena-result-win' : 'arena-result-lose');
    el.innerHTML = won ? '🏆 VITÓRIA!' : '💔 DERROTA';
    containerEl.appendChild(el);
    if(window.SFX && SFX.available()){ if(won) SFX.victory(); else SFX.defeat(); }
    s.resultBanner = el;
    el.classList.add('pop');
    // dispara o callback (recompensas etc.) — quem chamou decide o que fazer
    if(s.callbacks && s.callbacks.onEnd){
      s.callbacks.onEnd(won);
    }
    // botão continuar
    const btn = document.createElement('button');
    btn.className = 'arena-continue-btn';
    btn.textContent = 'Continuar';
    btn.addEventListener('click', ()=>{
      if(s.callbacks && s.callbacks.onClose) s.callbacks.onClose();
    });
    containerEl.appendChild(btn);
    s.continueBtn = btn;
  }

  function _tickResult(s, dt){
    // mantém o banner visível; nada a fazer — aguarda o botão Continuar
  }

  /* =========================================================
     API PÚBLICA
  ========================================================= */
  return {
    available(){ return typeof PIXI !== 'undefined'; },

    mount(el){
      containerEl = el;
      scene = null;
      if(typeof PIXI === 'undefined') return false; // CDN falhou: quem chamou usa o fallback emoji
      _ensureApp();
      return true;
    },

    destroy(){
      if(scene && scene.app){
        scene.app.destroy(true,{children:true, texture:false});
      }
      // limpa o DOM do HUD (labels/barras/floats anexados ao container) — sem
      // isso os elementos da luta anterior sobrevivem e empilham na próxima.
      _clearHud();
      scene = null;
      containerEl = null;
    },

    /* play(fightData, opts)
       fightData: {winner, rounds[], ratingA, ratingB, hpAStart, hpBStart, hpA, hpB}
       opts: { fA, fB, onEnd(won), onClose() }
       Pré-condição: mount(el) já foi chamado e o container está visível. */
    play(fightData, opts){
      opts = opts || {};
      if(!scene || !scene.app) return false;
      const s = scene;
      const fA = opts.fA || {}, fB = opts.fB || {};
      // estado do playback
      s.fight = fightData;
      s.callbacks = opts;
      s.roundIdx = 0;
      s.phase = 'enter';
      s.phaseT = 0;
      s.hpStart = { a: fightData.hpAStart, b: fightData.hpBStart };
      s.hp = { a: fightData.hpAStart, b: fightData.hpBStart };
      s.floats = [];
      s.puffs = [];
      s.sparks = [];
      s._hitFlashDone = false;
      s._shakeDone = false;
      s.ko = null;
      s.koText = null;
      s.resultBanner = null;
      s.continueBtn = null;

      // limpa o container de itens DOM efêmeros de uma luta anterior
      // (inclui labels e barras — _clearHud cobre todos os HUDs)
      _clearHud();

      // texturas da cena
      if(!s.T){
        s.T = { puff: buildPuffTexture(s.app), spark: buildSparkTexture(s.app) };
      }

      // fundo e galos (reconstrói a cada luta pra trocar raça/posição)
      s.ground.removeChildren().forEach(ch=>ch.destroy());
      s.fighters.removeChildren().forEach(ch=>ch.destroy());
      s.galoA = null; s.galoB = null;

      // medidas
      const W = s.app.renderer.width/s.app.renderer.resolution;
      const H = s.app.renderer.height/s.app.renderer.resolution;
      s.baseY = H*0.78;
      s.baseX = { a: W/2 - 90, b: W/2 + 90 };
      s.enterXA0 = W/2 - 90 - W*0.45;
      s.enterXB0 = W/2 + 90 + W*0.45;
      _buildWorld(fA, fB);
      _placeTopHUD();

      // garante os galos nas posições iniciais da fase 'enter'
      s.galoA.x = s.enterXA0; s.galoA.y = s.baseY;
      s.galoB.x = s.enterXB0; s.galoB.y = s.baseY;
      s.galoA.scale.set(2.4); s.galoB.scale.set(2.4);
      s.galoB.scale.x *= -1;

      // reset das barras
      _setBar(s.barFillA, 1);
      _setBar(s.barFillB, 1);
      return true;
    },

    /* Hook de teste: expõe o estado interno (fase atual, app PIXI etc.)
       para o harness headless poder dirigir o ticker manualmente.
       Sem uso em produção. */
    _debug(){
      return scene;
    },
  };
})();
