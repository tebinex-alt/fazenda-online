/* =========================================================
   CENA 2,5D ISOMÉTRICA — pixel art dinâmico (PixiJS)
   ---------------------------------------------------------
   Substitui a cena antiga (divs + emojis) por um canvas
   isométrico com sprites pixel art gerados por código:
   canteiros que crescem em estágios, galinhas andando,
   galinheiro/silo que evoluem por tier, e ciclo dia/noite.
   Tudo é desenhado em blocos (pixel art "bitmap") e depois
   sincronizado a cada renderScene() com o estado real do jogo.
========================================================= */
(function(){
  // NOTA: sem guarda de `PIXI` aqui — o Pixi é carregado por cadeia CDN
  // ASSÍNCRONA (index.html), então neste ponto ele ainda pode estar undefined.
  // A guarda fica no wrapper IsoFarmScene (abaixo), que roda em mount()/update(),
  // já depois do CDN terminar. O construtor também se protege.

  const TILE_W = 44, TILE_H = 22;      // proporção 2:1 da losango isométrica
  const COLS = 9, ROWS = 6;            // grade lógica do terreno
  const PLOT_COLS = 4, PLOT_ORIGIN = {c:0, r:2}; // até 12 canteiros (4x3)
  const COOP_ORIGIN = {c:6, r:1};      // galinheiro (2x2)
  const SILO_TILE = {c:8, r:2};
  const DAY_CYCLE_MS = 130000;         // ciclo completo dia/noite

  function isoToScreen(c,r){
    return { x:(c-r)*(TILE_W/2), y:(c+r)*(TILE_H/2) };
  }

  // --- desenha formas "pixeladas" em blocos, sem antialiasing suave ---
  function newG(){ return new PIXI.Graphics(); }

  function drawDiamondBlocks(g, wBlocks, hBlocks, block, colorFn, offX=0, offY=0){
    for(let by=0; by<hBlocks; by++){
      for(let bx=0; bx<wBlocks; bx++){
        const nx = (bx+0.5)/wBlocks*2-1;
        const ny = (by+0.5)/hBlocks*2-1;
        if(Math.abs(nx)+Math.abs(ny) <= 1.001){
          const c = colorFn(bx,by,wBlocks,hBlocks);
          if(c===null || c===undefined) continue;
          g.beginFill(c);
          g.drawRect(offX+bx*block, offY+by*block, block, block);
          g.endFill();
        }
      }
    }
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

  function toTexture(app, g, w, h){
    const rt = PIXI.RenderTexture.create({width:Math.max(1,w), height:Math.max(1,h), resolution:2});
    app.renderer.render(g, {renderTexture:rt});
    rt.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
    g.destroy();
    return rt;
  }

  function mix(a,b,t){
    const ah=parseInt(a.slice(1),16), bh=parseInt(b.slice(1),16);
    const ar=(ah>>16)&255, ag=(ah>>8)&255, ab=ah&255;
    const br=(bh>>16)&255, bg=(bh>>8)&255, bb=bh&255;
    const r=Math.round(ar+(br-ar)*t), gg=Math.round(ag+(bg-ag)*t), b2=Math.round(ab+(bb-ab)*t);
    return (r<<16)|(gg<<8)|b2;
  }
  function hexNum(h){ return parseInt(h.slice(1),16); }
  function seeded(i){ let x=Math.sin(i*999.7)*10000; return x-Math.floor(x); }

  /* ---------------------------------------------------------
     GERAÇÃO DE TEXTURAS (pixel art)
  --------------------------------------------------------- */
  function buildTextures(app){
    const T = {};
    const B = 3; // tamanho do "pixel" lógico

    // --- grama (3 variações para dar textura ao terreno) ---
    T.grass = [];
    for(let v=0; v<3; v++){
      const g = newG();
      drawDiamondBlocks(g, 16, 8, B, (bx,by,w,h)=>{
        const shade = (bx+by+v*5)%7===0 ? '#4F7C46' : ((bx*3+by*2+v)%11===0 ? '#6C9A5F' : '#5B8C51');
        return hexNum(shade);
      });
      T.grass.push(toTexture(app, g, 16*B, 8*B));
    }

    // --- terra arada (canteiro vazio) ---
    {
      const g = newG();
      drawDiamondBlocks(g, 16, 8, B, (bx,by)=>{
        const stripe = (Math.floor(by/1.4)+ (by%2))%2===0;
        return hexNum(stripe ? '#7A5230' : '#6B4423');
      });
      T.soil = toTexture(app, g, 16*B, 8*B);
    }

    // --- caminho/base do silo e galinheiro ---
    {
      const g = newG();
      drawDiamondBlocks(g, 16, 8, B, (bx,by)=> hexNum((bx+by)%4===0?'#C9B888':'#D8C39F'));
      T.path = toTexture(app, g, 16*B, 8*B);
    }

    // --- broto (canteiro crescendo) — sprite avulso sobreposto ---
    {
      const g = newG();
      drawRectBlocks(g, 10, 8, B, (bx,by)=>{
        const stemCols = [2,4,6,7];
        if(stemCols.includes(bx) && by>=3){
          return hexNum('#4C8B5C');
        }
        if((bx===2||bx===4) && by===3) return hexNum('#6FBF73');
        if((bx===6||bx===7) && by===2) return hexNum('#6FBF73');
        return null;
      });
      T.sprout = toTexture(app, g, 10*B, 8*B);
    }

    // --- milho pronto (canteiro maduro) ---
    {
      const g = newG();
      drawRectBlocks(g, 12, 12, B, (bx,by)=>{
        const stalks = [1,3,5,7,9,10];
        if(!stalks.includes(bx)) return null;
        if(by>=6) return hexNum('#4C8B5C'); // talo
        if(by>=2 && by<6){
          // espiga dourada
          return (bx+by)%2===0 ? hexNum('#FFD166') : hexNum('#E8A93A');
        }
        if(by<2) return hexNum('#8FCB7A'); // folha no topo
        return null;
      });
      T.corn = toTexture(app, g, 12*B, 12*B);
    }

    // --- galinheiro por estágio (0..3), corpo + telhado ---
    T.coop = [];
    const coopPalettes = [
      { wall:'#8a5a4d', wallDark:'#6b4438', roof:'#6B4423', door:'#3E2A18' },
      { wall:'#B5423F', wallDark:'#8E332F', roof:'#6B4423', door:'#3E2A18' },
      { wall:'#d1524d', wallDark:'#a53d39', roof:'#4a7a86', door:'#3E2A18' },
      { wall:'#FFD166', wallDark:'#E8A93A', roof:'#B5423F', door:'#6B4423' },
    ];
    coopPalettes.forEach((pal, stage)=>{
      const wBlk=18, footD=9, wallH= stage>=2?16:13, roofH=8;
      const texW = wBlk*B, texH = (footD*B/2)+wallH*B+roofH*B+4;
      const g = newG();
      const baseY = texH - (footD*B/2);
      // parede esquerda (mais escura) e direita (clara) formando o corpo
      drawRectBlocks(g, wBlk/2, wallH, B, ()=> hexNum(pal.wallDark), 0, baseY-wallH*B);
      drawRectBlocks(g, wBlk/2, wallH, B, ()=> hexNum(pal.wall), (wBlk/2)*B, baseY-wallH*B);
      // porta
      drawRectBlocks(g, 4, 6, B, ()=> hexNum(pal.door), (wBlk/2-2)*B, baseY-6*B);
      // telhado (losango + fileiras que sobem, formando um "A" pixelado)
      for(let i=0;i<roofH;i++){
        const rowW = wBlk - i*1.6;
        const rowX = (wBlk-rowW)/2*B;
        drawRectBlocks(g, Math.max(1,Math.round(rowW)), 1, B, ()=> hexNum(i%2===0?pal.roof:mixHexShade(pal.roof)), rowX, baseY-wallH*B-(i+1)*B);
      }
      // base/fundação (losango)
      drawDiamondBlocks(g, wBlk, footD, B, ()=> hexNum(pal.wallDark), 0, baseY-4);
      if(stage>=3){
        // brilho lendário: pontinhos dourados no telhado
        drawRectBlocks(g, 2, 2, B, ()=> hexNum('#FFF3C4'), (wBlk/2-1)*B, baseY-wallH*B-roofH*B-2*B);
      }
      T.coop.push(toTexture(app, g, texW, texH));
      function mixHexShade(h){ return '#'+(Math.max(0,hexNum(h)-0x101010)).toString(16).padStart(6,'0'); }
    });

    // --- silo ---
    {
      const g = newG();
      const wBlk=7, bodyH=20, texW=wBlk*B, texH=bodyH*B+6*B;
      drawRectBlocks(g, wBlk, bodyH, B, (bx)=> hexNum(bx===0? '#8b979b' : (bx===wBlk-1?'#c7d2d5':'#dfe6e8')), 0, 6*B);
      drawDiamondBlocks(g, wBlk+2, 5, B, ()=> hexNum('#c94f4f'), -B, 2*B);
      T.silo = toTexture(app, g, texW, texH);
    }

    // --- cerca (poste simples) ---
    {
      const g = newG();
      drawRectBlocks(g, 2, 6, B, (bx,by)=> hexNum(by<1?'#6B4423':'#9C6B3E'));
      T.fence = toTexture(app, g, 2*B, 6*B);
    }

    // --- galinhas: 2 frames de caminhada x 4 cores (por raça) ---
    const chickenColors = ['#F3E6C8','#B5423F','#E8A93A','#66C6D9','#FF7CD1'];
    T.chicken = chickenColors.map(color=>{
      return [0,1].map(frame=>{
        const g = newG();
        const wBlk=8, hBlk=8;
        drawRectBlocks(g, wBlk, hBlk, B, (bx,by)=>{
          // corpo oval simplificado
          if(by>=2 && by<=5 && bx>=1 && bx<=6) return hexNum(color);
          if(by===1 && bx>=3 && bx<=5) return hexNum(color); // cabeça
          if(by===0 && bx===4) return hexNum('#B5423F'); // crista
          if(by===2 && bx===6) return hexNum('#E8A93A'); // bico
          // pernas (alternam entre os 2 frames = caminhada)
          if(by===6){
            if(frame===0 && (bx===2||bx===5)) return hexNum('#E8A93A');
            if(frame===1 && (bx===1||bx===6)) return hexNum('#E8A93A');
          }
          return null;
        });
        return toTexture(app, g, wBlk*B, hBlk*B);
      });
    });

    // --- sol e lua ---
    {
      const g = newG();
      drawDiamondBlocks(g, 12, 12, B, ()=> hexNum('#FFD166'));
      T.sun = toTexture(app, g, 12*B, 12*B);
    }
    {
      const g = newG();
      drawDiamondBlocks(g, 12, 12, B, (bx,by)=>{
        if((bx===4&&by===4)||(bx===7&&by===7)||(bx===8&&by===3)) return hexNum('#CBD5DA');
        return hexNum('#EAF0F2');
      });
      T.moon = toTexture(app, g, 12*B, 12*B);
    }
    // --- nuvem ---
    {
      const g = newG();
      drawRectBlocks(g, 14, 5, B, (bx,by)=>{
        const nx=(bx-6.5)/7, ny=(by-2)/2.4;
        return (nx*nx+ny*ny<=1) ? hexNum('#FFFFFF') : null;
      });
      T.cloud = toTexture(app, g, 14*B, 5*B);
    }
    // --- estrela ---
    {
      const g = newG();
      g.beginFill(hexNum('#FFF6D8'));
      g.drawRect(0,0,B,B);
      g.endFill();
      T.star = toTexture(app, g, B, B);
    }
    // --- brilho (stage lendário) ---
    {
      const g = newG();
      drawRectBlocks(g, 5, 5, B, (bx,by)=>{
        if(bx===2||by===2) return hexNum('#FFF3C4');
        return null;
      });
      T.sparkle = toTexture(app, g, 5*B, 5*B);
    }

    return T;
  }

  /* ---------------------------------------------------------
     CLASSE PRINCIPAL DA CENA
  --------------------------------------------------------- */
  function IsoScene(container){
    if(typeof PIXI === 'undefined'){ return; } // CDN falhou: cena fica vazia; ui.js mostra o fallback
    this.container = container;
    PIXI.settings.ROUND_PIXELS = true;
    PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST;
    this.app = new PIXI.Application({
      resizeTo: container,
      backgroundAlpha: 1,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio||1),
    });
    container.appendChild(this.app.view);
    this.app.view.style.position='absolute';
    this.app.view.style.inset='0';
    this.app.view.style.width='100%';
    this.app.view.style.height='100%';

    this.T = buildTextures(this.app);

    this.sky = new PIXI.Container();
    this.world = new PIXI.Container();
    this.fx = new PIXI.Container();
    this.app.stage.addChild(this.sky, this.world, this.fx);

    this.groundLayer = new PIXI.Container();
    this.plotsLayer = new PIXI.Container();
    this.objectsLayer = new PIXI.Container();
    this.chickenLayer = new PIXI.Container();
    this.world.addChild(this.groundLayer, this.plotsLayer, this.objectsLayer, this.chickenLayer);

    this.skyBand = new PIXI.Sprite(PIXI.Texture.WHITE);
    this.sky.addChild(this.skyBand);
    this.sunMoon = new PIXI.Sprite(this.T.sun);
    this.sunMoon.anchor.set(0.5);
    this.sky.addChild(this.sunMoon);
    this.stars = new PIXI.Container();
    this.sky.addChild(this.stars);
    for(let i=0;i<18;i++){
      const s = new PIXI.Sprite(this.T.star);
      s._seed = seeded(i);
      s.x = seeded(i)*600; s.y = seeded(i+50)*90;
      s.alpha = 0;
      this.stars.addChild(s);
    }
    this.clouds = [];
    for(let i=0;i<3;i++){
      const c = new PIXI.Sprite(this.T.cloud);
      c.alpha = .85;
      this.clouds.push(c);
      this.sky.addChild(c);
    }

    this._buildGround();
    this.coopSprite = null;
    this.siloSprite = null;
    this.stage3Sparkles = [];
    this.plotSprites = [];
    this.chickens = [];
    this.lastStage = -1;
    this.lastPlotCount = -1;
    this.lastChickenTarget = -1;
    this._sigPlots = '';

    this.startTime = Date.now();
    this._sinceSkyRebuild = 999;

    this.app.ticker.add((delta)=> this._tick(delta));
    this._layout();
  }

  IsoScene.prototype._layout = function(){
    const w = this.app.renderer.width / this.app.renderer.resolution;
    this.world.x = w/2 - ((COLS-1)*(TILE_W/2))/2 - 40;
    this.world.y = 18;
    this.skyBand.width = w;
    this.skyBand.height = this.app.renderer.height/this.app.renderer.resolution;
  };

  IsoScene.prototype._buildGround = function(){
    for(let r=0;r<ROWS;r++){
      for(let c=0;c<COLS;c++){
        const pos = isoToScreen(c,r);
        const idx = (c*7+r*13)%this.T.grass.length;
        const spr = new PIXI.Sprite(this.T.grass[idx]);
        spr.anchor.set(0.5,0.5);
        spr.x = pos.x; spr.y = pos.y;
        spr.width = TILE_W; spr.height = TILE_H;
        spr.zIndex = c+r;
        this.groundLayer.addChild(spr);
      }
    }
    // cerca ao longo da borda frontal
    for(let c=-1;c<=COLS;c++){
      const pos = isoToScreen(c, ROWS-0.5);
      const f = new PIXI.Sprite(this.T.fence);
      f.anchor.set(0.5,1);
      f.x = pos.x; f.y = pos.y+TILE_H/2;
      f.width = 8; f.height = 18;
      f.alpha = .9;
      this.groundLayer.addChild(f);
    }
  };

  IsoScene.prototype._ensurePlots = function(n){
    n = Math.min(n, PLOT_COLS*3);
    while(this.plotSprites.length < n){
      const i = this.plotSprites.length;
      const col = PLOT_ORIGIN.c + (i % PLOT_COLS);
      const row = PLOT_ORIGIN.r + Math.floor(i / PLOT_COLS);
      const pos = isoToScreen(col,row);
      const base = new PIXI.Sprite(this.T.soil);
      base.anchor.set(0.5,0.5);
      base.x = pos.x; base.y = pos.y;
      base.width = TILE_W; base.height = TILE_H;
      const crop = new PIXI.Sprite(this.T.sprout);
      crop.anchor.set(0.5,1);
      crop.x = pos.x; crop.y = pos.y+2;
      crop.visible = false;
      // clicável: mesma regra da cena antiga — colhe se pronto, planta se vazio
      base.eventMode = 'static'; base.cursor = 'pointer';
      base.on('pointertap', ()=>{
        const pl = state.plots[i];
        if(pl.ready) harvestPlot(i);
        else if(!pl.planted) plantPlot(i);
      });
      this.plotsLayer.addChild(base, crop);
      this.plotSprites.push({base, crop, col, row});
    }
  };

  IsoScene.prototype._ensureCoop = function(stage){
    if(this.coopSprite && this.lastStage===stage) return;
    if(this.coopSprite) this.coopSprite.destroy();
    const pos = isoToScreen(COOP_ORIGIN.c+1, COOP_ORIGIN.r+1);
    const tex = this.T.coop[Math.max(0,Math.min(3,stage))];
    const s = new PIXI.Sprite(tex);
    s.anchor.set(0.5,1);
    s.x = pos.x; s.y = pos.y+TILE_H/2;
    // clicável: abre a aba Galinheiro (mesma mecânica da cena antiga)
    s.eventMode = 'static'; s.cursor = 'pointer';
    s.on('pointertap', ()=>{ document.querySelector('.tab[data-tab="coop"]')?.click(); });
    this.objectsLayer.addChild(s);
    this.coopSprite = s;
    if(!this.siloSprite){
      const sp = isoToScreen(SILO_TILE.c, SILO_TILE.r);
      const silo = new PIXI.Sprite(this.T.silo);
      silo.anchor.set(0.5,1);
      silo.x = sp.x; silo.y = sp.y+TILE_H/2;
      this.objectsLayer.addChild(silo);
      this.siloSprite = silo;
    }
    // brilho extra no stage lendário
    this.stage3Sparkles.forEach(sp=>sp.destroy());
    this.stage3Sparkles = [];
    if(stage>=3){
      for(let i=0;i<4;i++){
        const sp = new PIXI.Sprite(this.T.sparkle);
        sp.anchor.set(0.5);
        sp.x = pos.x + (seeded(i)-0.5)*70;
        sp.y = pos.y - 40 - seeded(i+9)*30;
        sp._phase = i*1.3;
        this.fx.addChild(sp);
        this.stage3Sparkles.push(sp);
      }
    }
  };

  IsoScene.prototype._ensureChickens = function(target, colorWeights){
    target = Math.max(0, Math.min(10, target));
    while(this.chickens.length < target){
      const colorIdx = weightedColorIdx(colorWeights);
      const anchor = isoToScreen(COOP_ORIGIN.c+1, COOP_ORIGIN.r+1);
      const spr = new PIXI.Sprite(this.T.chicken[colorIdx][0]);
      spr.anchor.set(0.5,1);
      const yard = {x: anchor.x, y: anchor.y+TILE_H, rx: 95, ry: 34};
      const ang = Math.random()*Math.PI*2;
      const c = {
        sprite:spr, colorIdx, frame:0, frameTimer:0,
        x: yard.x, y: yard.y, tx: yard.x, ty: yard.y,
        speed: 10+Math.random()*10, yard, wait: Math.random()*2,
      };
      spr.x = c.x; spr.y = c.y;
      spr.width = 20; spr.height = 20;
      c.baseScaleX = spr.scale.x; c.baseScaleY = spr.scale.y; c.dir = 1;
      this.chickenLayer.addChild(spr);
      this.chickens.push(c);
      pickNewTarget(c);
    }
    while(this.chickens.length > target){
      const c = this.chickens.pop();
      c.sprite.destroy();
    }
  };

  function pickNewTarget(c){
    const ang = Math.random()*Math.PI*2;
    const r = Math.random();
    c.tx = c.yard.x + Math.cos(ang)*c.yard.rx*r;
    c.ty = c.yard.y + Math.sin(ang)*c.yard.ry*r;
  }
  function weightedColorIdx(weights){
    const total = weights.reduce((s,w)=>s+w,0) || 1;
    let roll = Math.random()*total;
    for(let i=0;i<weights.length;i++){ roll-=weights[i]; if(roll<=0) return i; }
    return 0;
  }

  IsoScene.prototype._rebuildSky = function(phase){
    // phase: 0=amanhecer 0.25=dia 0.5=entardecer 0.75=noite (contínuo)
    const day    = ['#8fd0e8','#cdead6'];
    const dusk   = ['#ffb27a','#e9c07a'];
    const night  = ['#0e1a33','#243a5e'];
    const dawn   = ['#f2c98f','#f6e2b0'];
    let top, bot, t;
    if(phase<0.25){ t=phase/0.25; top=mix(hexToStr(night[0]),hexToStr(dawn[0]),t); bot=mix(hexToStr(night[1]),hexToStr(dawn[1]),t); }
    else if(phase<0.5){ t=(phase-0.25)/0.25; top=mix(hexToStr(dawn[0]),hexToStr(day[0]),t); bot=mix(hexToStr(dawn[1]),hexToStr(day[1]),t); }
    else if(phase<0.75){ t=(phase-0.5)/0.25; top=mix(hexToStr(day[0]),hexToStr(dusk[0]),t); bot=mix(hexToStr(day[1]),hexToStr(dusk[1]),t); }
    else { t=(phase-0.75)/0.25; top=mix(hexToStr(dusk[0]),hexToStr(night[0]),t); bot=mix(hexToStr(dusk[1]),hexToStr(night[1]),t); }
    function hexToStr(n){ return n; }
    const g = newG();
    const bands=10;
    for(let i=0;i<bands;i++){
      const c = mix('#'+top.toString(16).padStart(6,'0'), '#'+bot.toString(16).padStart(6,'0'), i/(bands-1));
      g.beginFill(c);
      g.drawRect(0, i*4, 4, 4);
      g.endFill();
    }
    if(this._skyTex) this._skyTex.destroy(true);
    this._skyTex = toTexture(this.app, g, 4, bands*4);
    this.skyBand.texture = this._skyTex;
    this._nightFactor = phase>=0.75 ? (phase-0.75)/0.25 : (phase<0.25 ? 1-phase/0.25 : 0);
  };

  IsoScene.prototype.sync = function(gameState, opts){
    const stage = opts.stage;
    this._ensurePlots(gameState.plots.length);
    const sig = gameState.plots.map(p=> p.ready?'r':(p.planted?'g':'e')).join('');
    if(sig !== this._sigPlots){
      this._sigPlots = sig;
      gameState.plots.forEach((p,i)=>{
        const ps = this.plotSprites[i]; if(!ps) return;
        if(p.ready){ ps.crop.texture = this.T.corn; ps.crop.visible = true; ps.crop.width=24; ps.crop.height=26; }
        else if(p.planted){ ps.crop.texture = this.T.sprout; ps.crop.visible = true; ps.crop.width=18; ps.crop.height=16; }
        else { ps.crop.visible = false; }
      });
    }
    this._ensureCoop(stage);
    this.lastStage = stage;

    const weights = opts.breedWeights || [1,0,0,0,0];
    const target = Math.max(1, Math.min(10, opts.chickenCount||1));
    if(target !== this.lastChickenTarget){
      this._ensureChickens(target, weights);
      this.lastChickenTarget = target;
    }
    if(this.labelText !== opts.label){
      this.labelText = opts.label;
      if(this.onLabel) this.onLabel(opts.label);
    }
  };

  IsoScene.prototype._tick = function(delta){
    this._layout(); // barato: mantém a cena centralizada se o container mudar de tamanho
    const dtSec = this.app.ticker.deltaMS/1000;
    const elapsed = Date.now()-this.startTime;
    const phase = (elapsed % DAY_CYCLE_MS)/DAY_CYCLE_MS;

    this._sinceSkyRebuild += dtSec;
    if(this._sinceSkyRebuild > 1.5){
      this._sinceSkyRebuild = 0;
      this._rebuildSky(phase);
    }

    // sol/lua num arco
    const w = this.app.renderer.width/this.app.renderer.resolution;
    const isDay = phase>=0.15 && phase<0.65;
    const arcPhase = isDay ? (phase-0.15)/0.5 : ((phase<0.15? phase+0.35 : phase-0.65)/0.5);
    this.sunMoon.texture = isDay ? this.T.sun : this.T.moon;
    this.sunMoon.x = 30 + arcPhase*(w-60);
    this.sunMoon.y = 70 - Math.sin(arcPhase*Math.PI)*55;
    this.sunMoon.width = 22; this.sunMoon.height = 22;

    const nf = this._nightFactor||0;
    this.stars.children.forEach(s=>{ s.alpha = nf*(0.5+0.5*Math.sin(elapsed/600 + s._seed*10)); });

    this.clouds.forEach((c,i)=>{
      c.width=42; c.height=15;
      c.x = ((elapsed/1000)*(6+i*3) + i*160) % (w+80) - 40;
      c.y = 14+i*20;
    });

    this.stage3Sparkles.forEach(sp=>{
      sp.alpha = 0.3+0.7*Math.abs(Math.sin(elapsed/500 + sp._phase));
      sp.width = sp.height = 6+2*Math.sin(elapsed/400+sp._phase);
    });

    // canteiros crescendo: leve "respiração" nos brotos
    this.plotSprites.forEach((ps,i)=>{
      if(ps.crop.visible && ps.crop.texture===this.T.sprout){
        ps.crop.y = isoToScreen(ps.col,ps.row).y + 2 + Math.sin(elapsed/500+i)*1.2;
      }
    });

    // galinhas caminhando
    this.chickens.forEach(c=>{
      const dx=c.tx-c.x, dy=c.ty-c.y, d=Math.hypot(dx,dy);
      if(d<3){
        c.wait -= dtSec;
        if(c.wait<=0){ pickNewTarget(c); c.wait = 1+Math.random()*2.5; }
      } else {
        c.x += dx/d*c.speed*dtSec;
        c.y += dy/d*c.speed*dtSec;
        c.dir = dx<0 ? -1 : 1;
        c.sprite.scale.x = c.baseScaleX*c.dir;
      }
      c.frameTimer += dtSec;
      if(c.frameTimer>0.22){ c.frameTimer=0; c.frame = c.frame?0:1; c.sprite.texture = this.T.chicken[c.colorIdx][c.frame]; }
      c.sprite.x = c.x; c.sprite.y = c.y;
      c.sprite.zIndex = 1000+c.y;
    });
    this.chickenLayer.sortableChildren = true;
    this.chickenLayer.children.forEach(s=> s.zIndex = s.y);
    this.chickenLayer.sortChildren();
  };

  IsoScene.prototype.destroy = function(){
    this.app.destroy(true,{children:true, texture:false});
  };

  window.IsoScene = IsoScene;

  /* ---------------------------------------------------------
     WRAPPER IsoFarmScene — espelha a API do FarmScene
     (mount/update) para a ui.js trocar só 1 linha. A guarda de
     PIXI roda aqui em tempo de chamada (e não no IIFE), porque o
     Pixi é carregado por CDN assíncrono e pode ainda não existir
     quando este arquivo executa.
  --------------------------------------------------------- */
  window.IsoFarmScene = (function(){
    "use strict";
    const BREED_ORDER = ['caipira','vermelha','dourada','cristal','lendaria']; // = T.chicken
    let scene = null, containerEl = null;
    return {
      mount(el){
        if(typeof PIXI === 'undefined' || !window.IsoScene) return; // CDN ainda carregando/falhou
        containerEl = el;
        scene = new window.IsoScene(el);
        if(!scene || !scene.app){ scene = null; return; } // guarda do construtor
      },
      update(){
        if(typeof PIXI === 'undefined' || !window.IsoScene) return;
        const el = document.getElementById('scene');
        if(!el) return;
        if(containerEl !== el){ if(scene) scene.destroy(); scene = null; this.mount(el); return; }
        if(!scene) this.mount(el);
        if(!scene) return;
        const stage = currentTier().stage;
        const weights = BREED_ORDER.map(b=> state.coop[b]?.count || 0);
        const total = totalChickens();
        scene.sync(state, {
          stage,
          breedWeights: weights,
          chickenCount: Math.max(1, Math.min(10, total)),
          label: currentTier().name+' · '+total+' galinhas'
        });
        this._syncLabel();
      },
      _syncLabel(){
        // IsoScene só expõe onLabel (hook, sem render padrão) — desenhamos por
        // DOM, reusando o CSS .stage-label que já existe.
        if(!containerEl || !scene || !scene.labelText) return;
        let el = containerEl.querySelector('.iso-stage-label');
        if(!el){
          el = document.createElement('div');
          el.className = 'stage-label iso-stage-label';
          containerEl.appendChild(el);
        }
        if(el.textContent !== scene.labelText) el.textContent = scene.labelText;
      }
    };
  })();
})();
