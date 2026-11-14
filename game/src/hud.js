// DOM HUD: scores, vitals, feed, banners, radar, buy menu, scoreboard and menus.
import { BUY_LIST } from './weapon.js';

const $ = (id) => document.getElementById(id);

function clock(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function createHud(map) {
  const els = {
    hud: $('hud'), overlay: $('overlay'), deploy: $('deploy'),
    scoreEmber: $('score-ember'), scoreWarden: $('score-warden'),
    roundNum: $('round-num'), timer: $('timer'), phase: $('phase-label'),
    bomb: $('bombstatus'), bombTimer: $('bomb-timer'),
    killfeed: $('killfeed'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    dmg: $('dmg'), dmgArc: $('dmg').querySelector('i'), dmgFlash: $('dmgflash'),
    interact: $('interact'), interactRing: $('interact').querySelector('.ring'), interactLabel: $('interact-label'),
    hint: $('hint'), death: $('death'),
    hpFill: $('hp-fill'), hpNum: $('hp-num'), hpBar: $('hp-bar'),
    arFill: $('ar-fill'), arNum: $('ar-num'), arBar: $('ar-bar'), vitals: $('vitals'),
    money: $('money-num'), wpn: $('wpn-name'), mag: $('ammo-mag'), reserve: $('ammo-reserve'), ammo: $('ammo'),
    objective: $('objective'),
    radar: $('radar'),
    buy: $('buy'), buyMoney: $('buy-money'), buyTimer: $('buy-timer'), buyGrid: $('buy-grid'), buyClose: $('buy-close'),
    board: $('scoreboard'), boardEmber: $('board-ember'), boardWarden: $('board-warden'), boardScore: $('board-score'), boardClose: $('board-close'),
  };
  const ctx = els.radar.getContext('2d');

  let callbacks = { play: null, buy: null, closeBuy: null, closeBoard: null };
  let buyOpen = false;
  let boardOpen = false;
  let radarWalls = null;
  let radarAccum = 0;
  let hitTimer = 0;
  let dmgTimer = 0;
  let feedSignature = '';
  let lastBanner = '';
  let lastTimer = '';
  let lastPhase = '';
  let lastMoney = -1;
  let lastAmmo = '';
  let lastHp = -1;
  let lastAr = -1;

  els.deploy.addEventListener('click', () => callbacks.play?.());
  els.buyClose.addEventListener('click', () => callbacks.closeBuy?.());
  els.boardClose.addEventListener('click', () => callbacks.closeBoard?.());

  // Build the fixed buy cards once; refresh only their availability.
  const cards = new Map();
  for (const item of BUY_LIST) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.id = item.id;
    card.innerHTML = `<span class="key"></span><div class="kind">${item.label}</div><div class="nm">${item.detail}</div><div class="dt">${item.kind.toUpperCase()}</div><div class="pr">$${item.price}</div>`;
    card.addEventListener('click', () => callbacks.buy?.(item.id));
    els.buyGrid.appendChild(card);
    cards.set(item.id, card);
  }
  let buyKeyIndex = 0;
  for (const card of cards.values()) {
    buyKeyIndex += 1;
    card.querySelector('.key').textContent = String(buyKeyIndex);
  }

  function setVitals(hp, armor, alive) {
    const health = Math.max(0, Math.round(hp));
    const armorValue = Math.max(0, Math.round(armor));
    if (health !== lastHp) {
      lastHp = health;
      els.hpNum.textContent = String(health);
      els.hpFill.style.width = `${health}%`;
      els.hpBar.classList.toggle('low', health <= 30);
      els.vitals.classList.toggle('low', health <= 30);
    }
    if (armorValue !== lastAr) {
      lastAr = armorValue;
      els.arNum.textContent = String(armorValue);
      els.arFill.style.width = `${armorValue}%`;
    }
    els.hpNum.style.opacity = alive ? '1' : '.4';
  }

  function setAmmo(mag, reserve, name, empty) {
    const signature = `${mag}/${reserve}/${name}`;
    if (signature === lastAmmo) return;
    lastAmmo = signature;
    els.mag.textContent = String(mag);
    els.reserve.textContent = `/ ${reserve}`;
    els.wpn.textContent = name;
    els.ammo.classList.toggle('empty', empty || mag === 0);
  }

  function setMoney(value) {
    const money = Math.round(value);
    if (money === lastMoney) return;
    lastMoney = money;
    els.money.textContent = String(money);
  }

  function setTimer(state) {
    const planted = state.bomb.state === 'planted';
    let display;
    let phase = '';
    let low = false;
    if (state.phase === 'buy') {
      display = clock(state.buyTimer);
      phase = 'BUY PHASE';
    } else if (state.phase === 'live') {
      if (planted) {
        display = clock(state.bomb.timer);
        phase = 'CORE ARMED';
        low = state.bomb.timer < 10;
      } else {
        display = clock(state.roundTimer);
        phase = state.sideOf(state.playerTeam) === 'attack' ? 'PULSE SITE A' : 'DEFEND SITE A';
        low = state.roundTimer < 15;
      }
    } else if (state.phase === 'roundEnd') {
      display = '—';
      phase = 'ROUND OVER';
    } else if (state.phase === 'halftime') {
      display = '—';
      phase = 'HALF TIME';
    } else if (state.phase === 'matchEnd') {
      display = '—';
      phase = 'MATCH OVER';
    } else {
      display = clock(state.roundTimer);
      phase = 'STANDBY';
    }
    if (display !== lastTimer) {
      lastTimer = display;
      els.timer.textContent = display;
      els.timer.classList.toggle('low', low);
    }
    if (phase !== lastPhase) {
      lastPhase = phase;
      els.phase.textContent = phase;
    }
    els.roundNum.textContent = `ROUND ${state.round}`;
    const score = `${state.scores.ember} : ${state.scores.warden}`;
    if (els.scoreEmber.textContent !== String(state.scores.ember)) els.scoreEmber.textContent = String(state.scores.ember);
    if (els.scoreWarden.textContent !== String(state.scores.warden)) els.scoreWarden.textContent = String(state.scores.warden);
    els.bomb.hidden = !planted;
    if (planted) {
      els.bombTimer.textContent = clock(state.bomb.timer);
      els.bomb.hidden = false;
      els.bomb.dataset.score = score;
    }
    els.buyTimer.textContent = clock(state.buyTimer);
  }

  function setBanner(banner) {
    const signature = `${banner.text}|${banner.sub}|${banner.time > 0}`;
    if (signature === lastBanner) return;
    lastBanner = signature;
    els.bannerTitle.textContent = banner.text;
    els.bannerSub.textContent = banner.sub;
    els.banner.classList.toggle('on', banner.time > 0 && banner.text.length > 0);
  }

  function setFeed(feed) {
    const signature = feed.map((entry) => `${entry.killer}|${entry.victim}|${entry.weapon}|${entry.headshot}`).join(',');
    if (signature === feedSignature) return;
    feedSignature = signature;
    const rows = feed.slice(-5).reverse();
    els.killfeed.innerHTML = rows.map((entry) => {
      const cls = entry.self ? 'self' : entry.killerTeam === 'ember' ? '' : 'enemy';
      return `<div class="feed ${cls}"><span class="k">${entry.killer}</span><span class="w">${entry.weapon}</span>${entry.headshot ? '<span class="hs">HS</span>' : ''}<span class="v">${entry.victim}</span></div>`;
    }).join('');
  }

  function setCrosshair(spread) {
    const gap = Math.max(4, Math.min(34, 4 + spread * 340));
    els.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
  }

  function hit(headshot) {
    els.hitmarker.classList.add('on');
    els.hitmarker.classList.toggle('head', Boolean(headshot));
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => {
      els.hitmarker.classList.remove('on');
      els.hitmarker.classList.remove('head');
    }, 110);
  }

  function forceHit(headshot) {
    clearTimeout(hitTimer);
    els.hitmarker.classList.add('on');
    els.hitmarker.classList.toggle('head', Boolean(headshot));
  }

  function damage(angle) {
    els.dmgArc.style.transform = `rotate(${angle}rad)`;
    els.dmg.classList.add('on');
    els.dmgFlash.classList.add('on');
    clearTimeout(dmgTimer);
    dmgTimer = setTimeout(() => {
      els.dmg.classList.remove('on');
      els.dmgFlash.classList.remove('on');
    }, 420);
  }

  function setObjective(text) {
    if (els.objective.dataset.text === text) return;
    els.objective.dataset.text = text;
    els.objective.innerHTML = text;
  }

  function setInteract(visible, progress, label) {
    els.interact.classList.toggle('on', visible);
    if (!visible) return;
    els.interactRing.style.setProperty('--p', String(Math.max(0, Math.min(1, progress))));
    if (els.interactLabel.textContent !== label) els.interactLabel.textContent = label;
  }

  function setHint(visible) {
    els.hint.classList.toggle('on', visible);
  }

  function setDeath(visible) {
    els.death.hidden = !visible;
  }

  function setMenu(visible) {
    els.overlay.hidden = !visible;
  }

  function setBuyOpen(open, data) {
    buyOpen = open;
    els.buy.hidden = !open;
    els.hud.classList.toggle('buy-open', open);
    if (open && data) refreshBuy(data);
  }

  function refreshBuy(data) {
    els.buyMoney.textContent = `$${Math.round(data.money)}`;
    for (const item of BUY_LIST) {
      const card = cards.get(item.id);
      if (!card) continue;
      const owned = data.owned?.has(item.id);
      const allowed = !data.allowed || data.allowed.has(item.id);
      const afford = data.money >= item.price;
      card.disabled = !allowed || !afford || owned;
      card.classList.toggle('owned', Boolean(owned));
      const price = card.querySelector('.pr');
      if (owned) price.textContent = 'OWNED';
      else if (!allowed) price.textContent = 'DEFENDERS ONLY';
      else price.textContent = `$${item.price}`;
    }
  }

  function setBoardOpen(open) {
    boardOpen = open;
    els.board.hidden = !open;
  }

  function refreshBoard(rows, state) {
    const make = (team) => rows.filter((row) => row.team === team).map((row) => {
      const me = row.me ? 'me' : '';
      const dead = row.alive ? '' : 'dead';
      const color = team === 'ember' ? '#f2a13c' : '#54b6d8';
      return `<tr class="${me} ${dead}"><td class="pname"><span class="chip" style="background:${color}"></span>${row.name}</td><td class="k">${row.kills}</td><td class="d">${row.deaths}</td><td class="m">$${Math.round(row.money)}</td><td>${row.alive ? 'LIVE' : 'DOWN'}</td></tr>`;
    }).join('');
    const emberRows = make('ember');
    const wardenRows = make('warden');
    if (els.boardEmber.dataset.sig !== emberRows) {
      els.boardEmber.dataset.sig = emberRows;
      els.boardEmber.innerHTML = emberRows;
    }
    if (els.boardWarden.dataset.sig !== wardenRows) {
      els.boardWarden.dataset.sig = wardenRows;
      els.boardWarden.innerHTML = wardenRows;
    }
    els.boardScore.textContent = `EMBER ${state.scores.ember} : ${state.scores.warden} WARDEN — ROUND ${state.round}`;
    els.boardClose.textContent = state.phase === 'matchEnd' ? 'REDEPLOY' : 'CLOSE';
    els.board.classList.toggle('final', state.phase === 'matchEnd');
    els.hud.classList.toggle('hud-final', state.phase === 'matchEnd');
  }

  function buildRadarWalls() {
    const size = els.radar.width;
    radarWalls = document.createElement('canvas');
    radarWalls.width = size;
    radarWalls.height = size;
    const g = radarWalls.getContext('2d');
    g.fillStyle = 'rgba(8,13,17,1)';
    g.fillRect(0, 0, size, size);
    const scale = size / 44;
    g.fillStyle = 'rgba(150,174,186,0.42)';
    for (let iz = 0; iz < 44; iz += 1) {
      for (let ix = 0; ix < 44; ix += 1) {
        if (!map.navSolid[iz * 44 + ix]) continue;
        g.fillRect(ix * scale, iz * scale, scale + 0.4, scale + 0.4);
      }
    }
    g.strokeStyle = 'rgba(242,161,60,0.7)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc((map.site.x + 22) * scale, (map.site.z + 22) * scale, map.site.radius * scale, 0, Math.PI * 2);
    g.stroke();
  }

  function setRadar(data, dt) {
    radarAccum += dt;
    if (radarAccum < 0.09) return;
    radarAccum = 0;
    if (!radarWalls) buildRadarWalls();
    const size = els.radar.width;
    const scale = size / 44;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(radarWalls, 0, 0);
    const px = (data.player.position.x + 22) * scale;
    const pz = (data.player.position.z + 22) * scale;

    // Pulse core marker.
    const bomb = data.bomb;
    if (bomb.state === 'planted' || bomb.state === 'dropped') {
      const bx = (bomb.position.x + 22) * scale;
      const bz = (bomb.position.z + 22) * scale;
      ctx.save();
      ctx.translate(bx, bz);
      ctx.rotate(Math.PI / 4);
      const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 140);
      ctx.fillStyle = bomb.state === 'planted' ? `rgba(226,96,79,${pulse})` : 'rgba(242,161,60,0.9)';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    }
    for (const bot of data.bots) {
      if (!bot.alive) continue;
      if (bot.team !== data.player.team && !bot.spotted) continue;
      const bx = (bot.position.x + 22) * scale;
      const bz = (bot.position.z + 22) * scale;
      ctx.fillStyle = bot.team === data.player.team ? '#7fd6b2' : '#e2604f';
      ctx.beginPath();
      ctx.arc(bx, bz, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    const fx = -Math.sin(data.player.yaw);
    const fz = -Math.cos(data.player.yaw);
    ctx.fillStyle = '#e8e1d4';
    ctx.beginPath();
    ctx.moveTo(px + fx * 6, pz + fz * 6);
    ctx.lineTo(px - fx * 4 - fz * 3.4, pz - fz * 4 + fx * 3.4);
    ctx.lineTo(px - fx * 4 + fz * 3.4, pz - fz * 4 - fx * 3.4);
    ctx.closePath();
    ctx.fill();
  }

  function showMatchEnd() {
    setBoardOpen(true);
    setDeath(false);
  }

  return {
    els,
    onPlay(fn) { callbacks.play = fn; },
    onBuy(fn) { callbacks.buy = fn; },
    onCloseBuy(fn) { callbacks.closeBuy = fn; },
    onCloseBoard(fn) { callbacks.closeBoard = fn; },
    setVitals, setAmmo, setMoney, setTimer, setBanner, setFeed,
    setCrosshair, hit, forceHit, damage, setObjective, setInteract, setHint, setDeath, setMenu,
    setBuyOpen, refreshBuy, setBoardOpen, refreshBoard, setRadar, showMatchEnd,
    get buyOpen() { return buyOpen; },
    get boardOpen() { return boardOpen; },
  };
}
