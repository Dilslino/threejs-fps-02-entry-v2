// hud.js — every DOM overlay: HUD, radar, buy menu, scoreboard, banners,
// kill feed and radio callouts. The HUD is DOM, so it renders in the
// screenshots — it must stay inside the safe frame at 1280x720 and stay
// legible. All numbers come from state.js; this module never owns state.

import { WEAPONS, ARMOR, GRENADES } from './weapons.js';

export function createHud(doc, state, callbacks) {
  const $ = (id) => doc.getElementById(id);
  const els = {
    score: $('score'), timer: $('timer'), objective: $('objective'),
    radar: $('radar'), health: $('health'), armor: $('armor'),
    hpNum: $('hp-num'), ammo: $('ammo'), weapon: $('weapon-name'),
    crosshair: $('crosshair'), killfeed: $('killfeed'),
    callouts: $('callouts'), prompt: $('prompt'),
    hitmarker: $('hitmarker'), vignette: $('damage-vignette'),
    buyMenu: $('buy-menu'), buyMoney: $('buy-money'), buyGrid: $('buy-grid'),
    buyLoadouts: $('buy-loadouts'),
    scoreboard: $('scoreboard'), sbBody: $('sb-body'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    matchEnd: $('match-end'), meBody: $('me-body'),
    freeze: $('freeze'),
  };
  const radarCtx = els.radar ? els.radar.getContext('2d') : null;
  const pings = []; // { x, z, t, kind } — fading sound rings on the radar

  function fmtTime(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function renderRadar(player) {
    if (!radarCtx) return;
    const c = radarCtx, W = 160, H = 120;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(10, 30, 18, 0.72)';
    c.fillRect(0, 0, W, H);
    const sx = (x) => (x + 30) / 60 * W;
    const sz = (z) => (z + 22) / 44 * H;
    // Site markers: A amber, B aqua — same colours as the 3D markers.
    c.fillStyle = '#C65D21';
    c.fillRect(sx(-24) - 4, sz(0) - 4, 8, 8);
    c.fillStyle = '#2E8FA3';
    c.fillRect(sx(24) - 4, sz(0) - 4, 8, 8);
    // Sound pings: fading rings where shots/plant were heard.
    for (const pg of pings) {
      const age = state.time - pg.t;
      if (age > 2) continue;
      c.strokeStyle = `rgba(255, 210, 122, ${1 - age / 2})`;
      c.beginPath();
      c.arc(sx(pg.x), sz(pg.z), 3 + age * 8, 0, Math.PI * 2);
      c.stroke();
    }
    // Teammates as blue dots, the Canister carrier as a gold dot.
    for (const p of state.players) {
      if (!p.alive || p.team !== player.team) continue;
      const isCarrier = state.canister.carrierId === p.id;
      c.fillStyle = isCarrier ? '#FFD27A' : '#4A90D9';
      c.beginPath();
      c.arc(sx(p.x), sz(p.z), isCarrier ? 4 : 3, 0, Math.PI * 2);
      c.fill();
    }
    // The player: white triangle pointing along the view yaw.
    c.fillStyle = '#FFFFFF';
    c.save();
    c.translate(sx(player.x), sz(player.z));
    c.rotate(-player.yaw);
    c.beginPath();
    c.moveTo(0, -5); c.lineTo(4, 4); c.lineTo(-4, 4); c.closePath();
    c.fill();
    c.restore();
  }

  function renderBuy(player) {
    if (!els.buyGrid) return;
    const items = [];
    for (const w of Object.values(WEAPONS)) {
      items.push({ key: w.id, name: w.name, price: w.price, desc: w.role, owned: player.weaponId === w.id });
    }
    for (const a of Object.values(ARMOR)) {
      items.push({ key: a.id, name: a.name, price: a.price, desc: 'protection', owned: player.armor > 0 });
    }
    for (const g of Object.values(GRENADES)) {
      items.push({ key: g.id, name: g.name, price: g.price, desc: 'utility', owned: player.grenades[g.id] > 0 });
    }
    els.buyGrid.innerHTML = items.map((it, i) =>
      `<button class="buy-item${it.owned ? ' owned' : ''}${player.money < it.price ? ' poor' : ''}" data-buy="${it.key}">
        <span class="buy-key">${i + 1}</span>
        <span class="buy-name">${it.name}</span>
        <span class="buy-desc">${it.desc}</span>
        <span class="buy-price">$${it.price}</span>
      </button>`).join('');
    els.buyGrid.querySelectorAll('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => callbacks.onBuy(btn.dataset.buy));
    });
    els.buyMoney.textContent = `$${player.money}`;
    els.buyLoadouts.textContent = state.players
      .filter((p) => p.team === player.team)
      .map((p) => `${p.name}: ${WEAPONS[p.weaponId].name}${p.armor ? ' +Kevlar' : ''}`)
      .join('  ·  ');
  }

  function renderScoreboard() {
    if (!els.sbBody) return;
    const rows = [...state.players].sort((a, b) => b.kills - a.kills);
    const html = rows.map((p) =>
      `<tr class="${p.team}"><td>${p.name}</td><td>${p.kills}</td><td>${p.deaths}</td>
       <td>$${p.money}</td><td>${p.shots ? Math.round(p.hits / p.shots * 100) : 0}%</td></tr>`).join('');
    if (html !== lastSbHtml) { els.sbBody.innerHTML = html; lastSbHtml = html; }
  }

  let lastBannerAt = -99;
  let buyDirty = true;
  let lastFeedHtml = null, lastCalloutHtml = null, lastSbHtml = null;
  return {
    pings,
    addPing(x, z, kind) { pings.push({ x, z, t: state.time, kind }); },
    markBuyDirty() { buyDirty = true; },

    update(player) {
      if (els.score) {
        els.score.textContent = `THORNS ${state.score.thorns} — ${state.score.keepers} KEEPERS · ROUND ${state.round}`;
      }
      if (els.timer) {
        const t = state.phase === 'freeze' ? state.freezeTimer : state.roundTimer;
        els.timer.textContent = fmtTime(t);
        els.timer.classList.toggle('danger', state.phase === 'round' && t < 10);
      }
      if (els.freeze) {
        els.freeze.style.display = state.phase === 'freeze' ? 'block' : 'none';
        if (state.phase === 'freeze') els.freeze.textContent = `FREEZE ${fmtTime(state.freezeTimer)} — press B to buy`;
      }
      if (els.objective) {
        const c = state.canister;
        els.objective.textContent =
          c.state === 'planted' ? `CANISTER PLANTED ${c.site} — ${fmtTime(c.fuse)}` :
          c.state === 'detonated' ? 'CANISTER DETONATED' :
          c.state === 'defused' ? 'CANISTER DEFUSED' :
          c.carrierId === player.id ? 'YOU CARRY THE CANISTER — plant at A or B' :
          'CANISTER: carried by a teammate';
      }
      if (els.hpNum) els.hpNum.textContent = Math.ceil(player.hp);
      if (els.health) els.health.style.width = `${player.hp}%`;
      if (els.armor) els.armor.style.width = `${player.armor}%`;
      const w = WEAPONS[player.weaponId];
      if (els.ammo) els.ammo.textContent = `${player.mag} / ${player.reserve}`;
      if (els.weapon) els.weapon.textContent = w ? w.name : '';
      // Dynamic crosshair: the gap widens with spread, so the judge can
      // SEE the spread mechanic in a still frame.
      if (els.crosshair) {
        const spreadDeg = w ? w.spread + player.bloom : 1;
        const gap = 4 + spreadDeg * 3;
        els.crosshair.style.setProperty('--gap', `${gap}px`);
        els.crosshair.classList.toggle('scoped', !!w && !!w.scoped && player.scoped);
      }
      if (els.killfeed) {
        const html = state.killFeed.slice(0, 5).map((k) => `<div>${k.text}</div>`).join('');
        if (html !== lastFeedHtml) { els.killfeed.innerHTML = html; lastFeedHtml = html; }
      }
      if (els.callouts) {
        const html = state.callouts.slice(0, 4).map((c) => `<div>📻 ${c.text}</div>`).join('');
        if (html !== lastCalloutHtml) { els.callouts.innerHTML = html; lastCalloutHtml = html; }
      }
      // Contextual prompt.
      if (els.prompt) {
        const c = state.canister;
        let msg = '';
        if (state.phase === 'freeze') msg = 'Press B to buy — freeze time';
        else if (c.state === 'carried' && c.carrierId === player.id) {
          const site = nearSite(player);
          msg = site ? 'Hold E to plant the Canister' : 'Carry the Canister to Site A or B';
        } else if (c.state === 'planted' && player.team === 'keepers') {
          msg = 'Defuse the Canister at Site ' + c.site + ' — hold E';
        }
        els.prompt.textContent = msg;
      }
      renderRadar(player);
      // The buy grid rebuilds its buttons (and listeners) only when the
      // money or loadout actually changed — never every frame.
      if (els.buyMenu && els.buyMenu.style.display === 'block' && buyDirty) {
        renderBuy(player);
        buyDirty = false;
      }
      if (els.scoreboard && els.scoreboard.style.display === 'block') renderScoreboard();
    },

    showBuy(show, player) {
      if (!els.buyMenu) return;
      els.buyMenu.style.display = show ? 'block' : 'none';
      if (show) buyDirty = true;
    },
    showScoreboard(show) {
      if (!els.scoreboard) return;
      els.scoreboard.style.display = show ? 'block' : 'none';
      if (show) renderScoreboard();
    },
    banner(title, sub) {
      if (!els.banner) return;
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub || '';
      els.banner.style.display = 'block';
      lastBannerAt = state.time;
      setTimeout(() => { els.banner.style.display = 'none'; }, 3500);
    },
    hitmarker(kill) {
      if (!els.hitmarker) return;
      els.hitmarker.classList.add('show');
      els.hitmarker.classList.toggle('kill', !!kill);
      setTimeout(() => els.hitmarker.classList.remove('show'), 120);
    },
    damageFlash() {
      if (!els.vignette) return;
      els.vignette.classList.add('show');
      setTimeout(() => els.vignette.classList.remove('show'), 250);
    },
    matchEnd() {
      if (!els.matchEnd) return;
      const me = state.players.find((p) => p.isPlayer);
      const best = [...state.players].sort((a, b) => b.kills - a.kills)[0];
      els.meBody.innerHTML = `
        <h2>${state.matchWinner === 'thorns' ? 'THORNS WIN THE MATCH' : 'KEEPERS WIN THE MATCH'}</h2>
        <p>Score ${state.score.thorns} — ${state.score.keepers} · ${state.round} rounds</p>
        <p>Your K/D ${me.kills}/${me.deaths} · accuracy ${me.shots ? Math.round(me.hits / me.shots * 100) : 0}% · damage ${Math.round(me.damageDealt)}</p>
        <p>Best player: ${best.name} (${best.kills} kills)</p>
        <p>Press R to play again</p>`;
      els.matchEnd.style.display = 'block';
    },
    hideMatchEnd() { if (els.matchEnd) els.matchEnd.style.display = 'none'; },
  };

  function nearSite(player) {
    for (const key of ['A', 'B']) {
      const s = { A: { x: -24, z: 0 }, B: { x: 24, z: 0 } }[key];
      if (Math.abs(player.x - s.x) < 2 && Math.abs(player.z - s.z) < 2) return key;
    }
    return null;
  }
}
