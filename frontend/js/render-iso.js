/* =========================================================
   CENA DA FAZENDA — top-down com profundidade falsa
   ---------------------------------------------------------
   Este arquivo NÃO contém nenhuma regra de jogo. Ele só LÊ o
   `state` (plots, coop, tierIndex...) e CHAMA as mesmas funções
   que já existiam em actions.js (plantPlot, harvestPlot) e o
   mesmo mecanismo de troca de aba. Produção, preços, tempos de
   crescimento, capacidade — tudo continua sendo decidido por
   engine.js/actions.js/config.js, exatamente como antes. Isso
   aqui só desenha o resultado de outro jeito.

   Estilo: sem grid isométrico. Cada sprite tem uma sombra oval
   embaixo (ancoragem no "pé") e a profundidade vem de:
     1) leve escala por posição Y (mais pra trás = um pouco menor)
     2) z-order pelo Y do pé do sprite (quem está mais embaixo na
        tela é desenhado por cima — profundidade "de palco")
========================================================= */
const FarmScene = (function(){
  "use strict";

  const PAL = {
    grass:'#5B8C51', grassDark:'#4c7a44', grassEdge:'#3A5A40',
    dirt:'#7A5230', dirtDark:'#54371D', dirtLight:'#93683f',
    path:'#c9a878', pathEdge:'#a9855a',
    woodLight:'#9C6B3E', woodMid:'#835a34', woodDark:'#6B4423',
    roof:'#B5423F', roofDark:'#8a2f2c', roofLight:'#cf5a4f',
    roofGold:'#FFD166', roofGoldDark:'#E8A93A',
    straw:'#E8A93A', strawDark:'#c98f2e',
    white:'#f3e7d3', cream:'#efe0c4', black:'#2E2418',
    comb:'#B5423F', beak:'#E8A93A', legs:'#c98a3c',
    sprout:'#6f9a44', sproutDark:'#4a6b2c', corn:'#E8A93A', cornDark:'#b8901f',
    grain:'#E8C86A',
  };
  const BREED_TONES = {
    caipira:  { body:'#efe0c4', tone:'#c9b79a' },
    vermelha: { body:'#c9755a', tone:'#8f4a34' },
    dourada:  { body:'#E8A93A', tone:'#b8901f' },
    cristal:  { body:'#c9eef2', tone:'#66C6D9' },
    lendaria: { body:'#f2c9ea', tone:'#c96fb0' },
  };

  let app=null, world=null, mounted=false, containerEl=null;
  let sky, ground, lightOverlay, stageLabel;
  let coopSprite, plotSprites=[], flock=[], grainParticles=[], feedDrops=[], eggs=[];
  let cycleT = 0.32;

  /* ---------- pixel art ---------- */
  function rasterize(w,h,drawFn){
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    const ctx=c.getContext('2d'); ctx.imageSmoothingEnabled=false;
    drawFn(ctx); return c;
  }
  function px(ctx,x,y,w,h,color){ ctx.fillStyle=color; ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h)); }
  function texFrom(canvas){
    const t=PIXI.Texture.from(canvas); t.baseTexture.scaleMode=PIXI.SCALE_MODES.NEAREST; return t;
  }
  function lerpHex(a,b,t){
    const ar=(a>>16)&255, ag=(a>>8)&255, ab=a&255, br=(b>>16)&255, bg=(b>>8)&255, bb=b&255;
    return (Math.round(ar+(br-ar)*t)<<16)|(Math.round(ag+(bg-ag)*t)<<8)|Math.round(ab+(bb-ab)*t);
  }

  function drawShadow(ctx,cx,cy,rw,rh){
    ctx.fillStyle='rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(cx,cy,rw,rh,0,0,Math.PI*2); ctx.fill();
  }

  let TEX=null;
  function buildTextures(){
    if(TEX) return TEX;
    TEX={};

    // canteiro: patch de terra retangular arredondado (vista de cima/3-4),
    // com sombra própria e 3 estágios de plantação.
    function plotBase(ctx){
      drawShadow(ctx,32,30,30,9);
      ctx.fillStyle=PAL.dirt;
      ctx.beginPath();
      if(ctx.roundRect) ctx.roundRect(4,10,56,20,6); else ctx.rect(4,10,56,20);
      ctx.fill();
      px(ctx,4,10,56,4,PAL.dirtLight);
      px(ctx,4,26,56,4,PAL.dirtDark);
    }
    TEX.plotEmpty = texFrom(rasterize(64,40,ctx=>plotBase(ctx)));
    TEX.plotGrowing = texFrom(rasterize(64,44,ctx=>{
      plotBase(ctx);
      const cx=32,cy=12;
      px(ctx,cx-1,cy-6,2,6,PAL.sproutDark);
      px(ctx,cx-5,cy-6,4,4,PAL.sprout);
      px(ctx,cx+2,cy-4,4,4,PAL.sprout);
    }));
    TEX.plotReady = texFrom(rasterize(64,50,ctx=>{
      plotBase(ctx);
      const cx=32,cy=10;
      px(ctx,cx-2,cy-14,3,14,PAL.sproutDark);
      px(ctx,cx-7,cy-12,5,5,PAL.sprout);
      px(ctx,cx+3,cy-10,5,5,PAL.sprout);
      px(ctx,cx-2,cy-14,5,9,PAL.corn);
      px(ctx,cx-1,cy-13,3,7,PAL.cornDark);
    }));

    // galinheiro (frente 3/4), com sombra oval no chão. 2 variantes (padrão /
    // dourada nos tiers altos) × dia/noite.
    function drawCoop(ctx, golden, night){
      const wood = night?'#3a2c1e':PAL.woodMid, woodL = night?'#4a3a28':PAL.woodLight, woodD = night?'#241a12':PAL.woodDark;
      const roof = golden?(night?'#7a5a1e':PAL.roofGold):(night?'#5a2620':PAL.roof);
      const roofD = golden?(night?'#5c4416':PAL.roofGoldDark):(night?'#3a1815':PAL.roofDark);
      const roofL = golden?'#fff0b8':(night?'#7a352a':PAL.roofLight);
      const win = night?'#ffd97a':PAL.straw, winEdge = night?'#fff0b8':PAL.strawDark;
      drawShadow(ctx,70,110,54,11);
      px(ctx,20,56,100,46,wood);
      px(ctx,20,56,100,6,woodL);
      for(let i=0;i<6;i++) px(ctx,24+i*16,62,3,40,woodD);
      px(ctx,60,76,20,26,woodD);
      px(ctx,62,78,16,22,'#120c08');
      px(ctx,30,66,14,12,win);
      px(ctx,30,66,14,2,winEdge);
      px(ctx,6,26,128,10,roofD);
      px(ctx,10,16,120,14,roof);
      px(ctx,10,16,120,4,roofL);
      px(ctx,60,4,20,16,roof);
      px(ctx,60,4,20,4,roofL);
      px(ctx,118,60,8,36,woodD);
      if(golden && !night){ ctx.fillStyle='rgba(255,209,102,.18)'; ctx.beginPath(); ctx.arc(70,60,64,0,Math.PI*2); ctx.fill(); }
    }
    TEX.coop = texFrom(rasterize(140,122,ctx=>drawCoop(ctx,false,false)));
    TEX.coopNight = texFrom(rasterize(140,122,ctx=>drawCoop(ctx,false,true)));
    TEX.coopGold = texFrom(rasterize(140,122,ctx=>drawCoop(ctx,true,false)));
    TEX.coopGoldNight = texFrom(rasterize(140,122,ctx=>drawCoop(ctx,true,true)));

    // galinha: parado, 2 passos de caminhada, e BICANDO (cabeça baixa)
    function drawChicken(ctx, pose, body, tone){
      const legOff = pose===1?1:(pose===2?-1:0);
      const peck = pose==='peck';
      drawShadow(ctx,20,32,9,3);
      px(ctx,14+legOff,26,2,6,PAL.legs); px(ctx,22-legOff,26,2,6,PAL.legs);
      px(ctx,12+legOff,31,6,2,PAL.legs); px(ctx,22-legOff,31,6,2,PAL.legs);
      const bodyY = peck ? 14 : 12;
      px(ctx,8,bodyY,22,16,body);
      px(ctx,6,bodyY+4,4,10,tone); px(ctx,26,bodyY+4,4,10,tone);
      px(ctx,10,bodyY+14,18,3,tone);
      px(ctx,10,bodyY+4,10,8,tone);
      px(ctx,26,bodyY-6,6,12,tone); px(ctx,30,bodyY-8,4,8,PAL.white);
      if(peck){
        // pescoço esticado pra baixo bicando o chão
        px(ctx,2,20,10,9,PAL.white);
        px(ctx,4,16,6,5,PAL.comb);
        px(ctx,0,26,4,3,PAL.beak);
        px(ctx,4,22,2,2,PAL.black);
      } else {
        px(ctx,4,6,10,10,PAL.white); px(ctx,2,8,4,6,PAL.white);
        px(ctx,4,2,6,5,PAL.comb); px(ctx,2,4,3,4,PAL.comb);
        px(ctx,0,10,4,3,PAL.beak);
        px(ctx,6,8,2,2,PAL.black);
      }
    }
    TEX.chicken = {};
    Object.keys(BREED_TONES).forEach(bid=>{
      const t=BREED_TONES[bid];
      TEX.chicken[bid] = {
        0: texFrom(rasterize(40,36,ctx=>drawChicken(ctx,0,t.body,t.tone))),
        1: texFrom(rasterize(40,36,ctx=>drawChicken(ctx,1,t.body,t.tone))),
        2: texFrom(rasterize(40,36,ctx=>drawChicken(ctx,2,t.body,t.tone))),
        peck: texFrom(rasterize(40,36,ctx=>drawChicken(ctx,'peck',t.body,t.tone))),
      };
    });

    // grãozinho de ração (partícula, tanto pra bicada quanto pra "chuva" de
    // ração perto do galinheiro)
    TEX.grain = texFrom(rasterize(6,6,ctx=>{ px(ctx,1,1,4,4,PAL.grain); px(ctx,2,2,2,2,PAL.strawDark); }));

    // ovo
    TEX.egg = texFrom(rasterize(14,18,ctx=>{
      px(ctx,4,2,6,2,'#fffaf0'); px(ctx,2,4,10,3,'#fffaf0');
      px(ctx,1,7,12,6,'#fffaf0'); px(ctx,2,13,10,3,'#fffaf0'); px(ctx,4,16,6,2,'#fffaf0');
      px(ctx,2,9,3,3,'#e8d9b8');
    }));

    return TEX;
  }

  /* ---------- montagem ---------- */
  function mount(el){
    if(mounted) return;
    containerEl = el;
    buildTextures();
    app = new PIXI.Application({ resizeTo: el, backgroundAlpha:0, antialias:false });
    el.innerHTML=''; el.appendChild(app.view);
    app.view.style.imageRendering='pixelated';
    app.view.style.width='100%'; app.view.style.height='100%';

    sky = new PIXI.Graphics(); app.stage.addChild(sky);
    ground = new PIXI.Graphics(); app.stage.addChild(ground);

    world = new PIXI.Container();
    world.sortableChildren = true;
    app.stage.addChild(world);

    lightOverlay = new PIXI.Graphics();
    lightOverlay.beginFill(0x1a1030).drawRect(0,0,4000,4000).endFill();
    lightOverlay.alpha = 0;
    app.stage.addChild(lightOverlay);

    stageLabel = new PIXI.Text('', { fontFamily:'Baloo 2, sans-serif', fontSize:12, fill:0xffffff, fontWeight:'700' });
    stageLabel.resolution = 2;
    const labelBg = new PIXI.Graphics(); labelBg.name='labelBg';
    app.stage.addChild(labelBg); app.stage.addChild(stageLabel);

    coopSprite = new PIXI.Sprite(TEX.coop);
    coopSprite.anchor.set(0.5,0.9);
    coopSprite.eventMode='static'; coopSprite.cursor='pointer';
    coopSprite.on('pointertap', ()=>{
      const btn = document.querySelector('.tab[data-tab="coop"]');
      if(btn) btn.click();
    });
    world.addChild(coopSprite);

    app.ticker.add((delta)=>tick(delta/60));
    mounted = true;
  }

  function paintSky(topHex, botHex, w, h){
    sky.clear();
    const steps=16;
    for(let i=0;i<steps;i++){ const t=i/steps; sky.beginFill(lerpHex(topHex,botHex,t)).drawRect(0,(h*0.62/steps)*i,w,h*0.62/steps+1).endFill(); }
  }
  function paintGround(w,h,tone){
    ground.clear();
    const groundTop = h*0.58;
    ground.beginFill(tone).drawRect(0, groundTop, w, h-groundTop).endFill();
    // faixa de terra/caminho central levando ao galinheiro
    ground.beginFill(PAL.path, 0.55);
    ground.drawRect(w*0.5, groundTop+6, w*0.5, h-groundTop-10);
    ground.endFill();
    // textura leve (pontinhos determinísticos)
    let seed=91;
    function rnd(){ seed=(seed*9301+49297)%233280; return seed/233280; }
    ground.beginFill(0x3d5423, 0.35);
    for(let i=0;i<40;i++){
      const gx = rnd()*w, gy = groundTop + rnd()*(h-groundTop);
      ground.drawRect(gx, gy, 3, 2);
    }
    ground.endFill();
  }

  /* ---------- perspectiva falsa: escala por posição Y ---------- */
  let SCENE_W=800, SCENE_H=240, GROUND_TOP=140;
  function depthScale(y){
    const t = Math.max(0, Math.min(1, (y-GROUND_TOP)/(SCENE_H-GROUND_TOP)));
    return 0.78 + 0.32*t; // mais pra trás (y menor) = um pouco menor
  }

  /* ---------- canteiros ---------- */
  let lastPlotCount=-1;
  function plotPositions(n){
    const cols = Math.min(5, Math.max(1,n));
    const spots = [];
    for(let i=0;i<n;i++){
      const col = i%cols, row = Math.floor(i/cols);
      const x = SCENE_W*0.10 + col*(SCENE_W*0.13);
      const y = GROUND_TOP + 18 + row*34;
      spots.push({x,y});
    }
    return spots;
  }
  function syncPlots(){
    const plots = state.plots;
    if(plots.length !== lastPlotCount){
      plotSprites.forEach(s=>world.removeChild(s));
      plotSprites = plots.map((p,i)=>{
        const spr = new PIXI.Sprite(TEX.plotEmpty);
        spr.anchor.set(0.5,0.78);
        spr.eventMode='static'; spr.cursor='pointer';
        spr.on('pointertap', ()=>{
          const pl = state.plots[i];
          if(pl.ready) harvestPlot(i);
          else if(!pl.planted) plantPlot(i);
        });
        world.addChild(spr);
        return spr;
      });
      lastPlotCount = plots.length;
    }
    const spots = plotPositions(plots.length);
    plots.forEach((p,i)=>{
      const spr = plotSprites[i], s = spots[i];
      spr.x = s.x; spr.y = s.y;
      spr.zIndex = s.y;
      const sc = depthScale(s.y);
      spr.scale.set(sc);
      let tex = TEX.plotEmpty, pulse=false;
      if(p.planted && !p.ready) tex = TEX.plotGrowing;
      else if(p.ready){ tex = TEX.plotReady; pulse = true; }
      spr.texture = tex; spr._pulse = pulse;
    });
  }

  /* ---------- galinhas ---------- */
  function breedList(){ return Object.keys(state.coop).filter(b=>(state.coop[b]?.count||0)>0); }
  function syncFlock(){
    const breeds = breedList();
    const total = breeds.reduce((s,b)=>s+state.coop[b].count,0);
    const visible = Math.max(0, Math.min(6, total));
    if(flock.length !== visible){
      const old = flock; flock=[];
      for(let i=0;i<visible;i++){
        flock.push(old[i] || {
          sprite:null, x: SCENE_W*0.45+Math.random()*SCENE_W*0.25, y: GROUND_TOP+30+Math.random()*70,
          targetX:0, targetY:0, state:'idle', stateTimer:Math.random()*2, walkPhase:0, facing:1,
          peckTimer: 2+Math.random()*3,
        });
      }
      old.slice(visible).forEach(c=>{ if(c.sprite) world.removeChild(c.sprite); });
    }
    const weighted=[];
    breeds.forEach(b=>{ for(let k=0;k<state.coop[b].count;k++) weighted.push(b); });
    flock.forEach((c,i)=>{
      c.breed = weighted.length ? weighted[Math.floor(i/flock.length*weighted.length)] : 'caipira';
      if(!c.sprite){
        c.sprite = new PIXI.Sprite(TEX.chicken[c.breed][0]);
        c.sprite.anchor.set(0.5,0.9);
        world.addChild(c.sprite);
      }
    });
  }
  function pickTarget(c){
    c.targetX = SCENE_W*0.42 + Math.random()*SCENE_W*0.32;
    c.targetY = GROUND_TOP+20 + Math.random()*90;
  }

  /* ---------- partículas: bicada (grão) e ração caindo perto do galinheiro ---------- */
  function spawnGrain(x,y){
    const g = new PIXI.Sprite(TEX.grain);
    g.anchor.set(0.5,0.5); g.x=x; g.y=y; g.zIndex=y+1;
    world.addChild(g);
    grainParticles.push({ sprite:g, life:0 });
  }
  function spawnFeedDrop(){
    const x = SCENE_W*0.78 + (Math.random()*30-15);
    const g = new PIXI.Sprite(TEX.grain);
    g.anchor.set(0.5,0.5); g.x=x; g.y=GROUND_TOP-10; g.zIndex=9999;
    world.addChild(g);
    feedDrops.push({ sprite:g, y0:GROUND_TOP-10, yTarget:GROUND_TOP+56+Math.random()*20, t:0 });
  }
  let feedDropTimer = 4;

  /* ---------- ovos ---------- */
  let eggSpawnTimer=3;
  function spawnEgg(){
    const s = new PIXI.Sprite(TEX.egg);
    s.anchor.set(0.5,1); s.x = SCENE_W*0.72+Math.random()*20; s.y = GROUND_TOP+66; s.alpha=0; s.zIndex=99999;
    world.addChild(s);
    eggs.push({ sprite:s, life:0 });
  }

  /* ---------- dia/noite (estético) ---------- */
  const DAY_LENGTH=90;
  let coopIsGold=false, coopIsNight=false;
  function updateDayNight(dt,w,h){
    cycleT = (cycleT+dt/DAY_LENGTH)%1;
    let top,bot,nightAlpha,night;
    const dayTop=0xBFE0E8, dayBot=0xEAF3D8, dawnTop=0x2b2145, dawnBot=0x7a4a55,
          duskTop=0x5b3a5c, duskBot=0xE8A93A, nightTop=0x120c1f, nightBot=0x241a3a;
    if(cycleT<0.25){ const t=cycleT/0.25; top=lerpHex(dawnTop,dayTop,t); bot=lerpHex(dawnBot,dayBot,t); nightAlpha=0.4*(1-t); night=t<0.5; }
    else if(cycleT<0.6){ top=dayTop; bot=dayBot; nightAlpha=0; night=false; }
    else if(cycleT<0.8){ const t=(cycleT-0.6)/0.2; top=lerpHex(dayTop,duskTop,t); bot=lerpHex(dayBot,duskBot,t); nightAlpha=0.5*t; night=t>0.5; }
    else{ const t=(cycleT-0.8)/0.2; top=lerpHex(duskTop,nightTop,t); bot=lerpHex(duskBot,nightBot,t); nightAlpha=0.5+0.15*t; night=true; }
    paintSky(top,bot,w,h);
    paintGround(w,h, night ? 0x2c4326 : 0x5B8C51);
    lightOverlay.width=w; lightOverlay.height=h; lightOverlay.alpha=nightAlpha;
    coopIsNight = night;
  }

  /* ---------- loop 60fps ---------- */
  function tick(dt){
    if(!mounted) return;
    const w = app.renderer.width, h = app.renderer.height;
    SCENE_W = w; SCENE_H = h; GROUND_TOP = h*0.58;
    updateDayNight(dt,w,h);

    const stage = (typeof currentTier==='function') ? currentTier().stage : 0;
    coopIsGold = stage>=3;
    coopSprite.texture = coopIsGold ? (coopIsNight?TEX.coopGoldNight:TEX.coopGold) : (coopIsNight?TEX.coopNight:TEX.coop);
    coopSprite.x = SCENE_W*0.8; coopSprite.y = GROUND_TOP+60;
    coopSprite.zIndex = coopSprite.y;
    coopSprite.scale.set(depthScale(coopSprite.y));

    plotSprites.forEach(spr=>{ spr.alpha = spr._pulse ? 0.85+Math.sin(performance.now()/300)*0.15 : 1; });

    // galinhas: andar, ciscar/bicar de vez em quando
    flock.forEach((c,i)=>{
      c.stateTimer -= dt;
      if(c.state==='idle' && c.stateTimer<=0){
        if(Math.random()<0.4){ c.state='peck'; c.stateTimer=0.9; spawnGrain(c.x,c.y-2); }
        else{ pickTarget(c); c.state='walk'; }
      } else if(c.state==='peck' && c.stateTimer<=0){ c.state='idle'; c.stateTimer=1+Math.random()*2; }
      if(c.state==='walk'){
        const dx=c.targetX-c.x, dy=c.targetY-c.y, dist=Math.hypot(dx,dy);
        if(dist<3){ c.state='idle'; c.stateTimer=1.2+Math.random()*2; }
        else{ const sp=18*dt; c.x+=(dx/dist)*sp; c.y+=(dy/dist)*sp; c.facing=dx>=0?1:-1; c.walkPhase+=dt*8; }
      }
      const sc = depthScale(c.y);
      const bob = c.state==='walk' ? Math.abs(Math.sin(c.walkPhase))*2.2 : 0;
      c.sprite.x=c.x; c.sprite.y=c.y-bob;
      c.sprite.zIndex=c.y+0.5;
      c.sprite.scale.x = c.facing*sc; c.sprite.scale.y = sc;
      let tex;
      if(c.state==='peck') tex = TEX.chicken[c.breed].peck;
      else if(c.state==='walk') tex = TEX.chicken[c.breed][Math.floor(c.walkPhase)%2===0?1:2];
      else tex = TEX.chicken[c.breed][0];
      c.sprite.texture = tex;
    });

    // grãozinhos da bicada: sobem de leve e somem
    for(let i=grainParticles.length-1;i>=0;i--){
      const g = grainParticles[i]; g.life+=dt;
      g.sprite.y -= dt*4; g.sprite.alpha = Math.max(0,1-g.life/0.6);
      if(g.life>0.6){ world.removeChild(g.sprite); grainParticles.splice(i,1); }
    }

    // "ração caindo" perto do galinheiro — ambiental, mostra vida no celeiro
    feedDropTimer -= dt;
    if(feedDropTimer<=0){ feedDropTimer = 3.5+Math.random()*3; spawnFeedDrop(); }
    for(let i=feedDrops.length-1;i>=0;i--){
      const f = feedDrops[i]; f.t += dt*1.6;
      f.sprite.y = f.y0 + (f.yTarget-f.y0)*Math.min(1,f.t);
      f.sprite.alpha = f.t<1 ? 1 : Math.max(0,1-(f.t-1)*2);
      f.sprite.zIndex = f.sprite.y;
      if(f.t>1.5){ world.removeChild(f.sprite); feedDrops.splice(i,1); }
    }

    // ovos: nascem perto do galinheiro, brilham (pulsam) e desaparecem
    eggSpawnTimer -= dt;
    if(eggSpawnTimer<=0){ eggSpawnTimer=5+Math.random()*4; spawnEgg(); }
    for(let i=eggs.length-1;i>=0;i--){
      const e = eggs[i]; e.life+=dt;
      if(e.life<0.4) e.sprite.alpha = e.life/0.4;
      else if(e.life<3.2){
        e.sprite.alpha = 0.85+Math.sin(performance.now()/220)*0.15; // brilho pulsante
        e.sprite.scale.set(1+Math.sin(performance.now()/220)*0.06);
      } else {
        e.sprite.alpha = Math.max(0,1-(e.life-3.2)/0.6);
        e.sprite.y -= dt*10;
        if(e.life>3.8){ world.removeChild(e.sprite); eggs.splice(i,1); }
      }
    }

    world.sortChildren();
  }

  /* ---------- API pública ---------- */
  function update(){
    if(!containerEl) return;
    if(!mounted) mount(containerEl);
    syncPlots();
    syncFlock();
    stageLabel.text = currentTier().name+' · '+totalChickens()+' galinhas';
    const w = app.renderer.width, h = app.renderer.height;
    stageLabel.x = w - stageLabel.width - 18;
    stageLabel.y = h - stageLabel.height - 14;
    const bg = app.stage.getChildByName('labelBg');
    bg.clear();
    bg.beginFill(0x2c2018,0.55);
    bg.drawRoundedRect(stageLabel.x-8, stageLabel.y-4, stageLabel.width+16, stageLabel.height+8, 8);
    bg.endFill();
  }

  return { mount, update };
})();
