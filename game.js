// ------------------------------------------------------
// CloverPit — Singleplayer horror version (NO network, NO leaderboard)
// ------------------------------------------------------

// --- КОНФИГ ---
const START_BALANCE = 100;
const START_DEBT = 50;
const SPINS_PER_ROUND = 5;
const SPIN_COST = 5;
const DEBT_GROWTH = 10;
const OFFER_CHANCE = 0.45;
const OFFER_COOLDOWN_ROLLS = 2;

// SYMBOLS
const SYMBOLS = [
  { emoji: "🍀", weight: 10, payout: 50 },
  { emoji: "💎", weight: 14, payout: 30 },
  { emoji: "🕯️", weight: 16, payout: 20 },
  { emoji: "📜", weight: 20, payout: 15 },
  { emoji: "🧲", weight: 20, payout: 12 },
  { emoji: "🪙", weight: 24, payout: 10 },
];

// BUFF_POOL с ценами
const BUFF_POOL = [
  { id: "magnet", name: "Магнит x1.2", effect: { payoutMult: 1.2 }, shopPrice: 80, desc: "Увеличивает выплаты на 20%." },
  { id: "luck", name: "Удача +5%", effect: { extraChance: 0.05 }, shopPrice: 60, desc: "Небольшой бонус к шансам редких символов." },
  { id: "spirit", name: "Дух x1.5 (🍀)", effect: { cloverMult: 1.5 }, shopPrice: 120, desc: "Усиление для трёх 🍀." },
  { id: "coupon", name: "Купон −1 к цене", effect: { spinDiscount: 1 }, shopPrice: 40, desc: "Каждый спин дешевле на 1 монету." },
];

// --- СОСТОЯНИЕ ---
const state = {
  round: 1,
  spinsLeft: SPINS_PER_ROUND,
  balance: START_BALANCE,
  debt: START_DEBT,
  lastOfferSpin: -OFFER_COOLDOWN_ROLLS,
  activeBuffs: [],
  bestRound: Number(localStorage.getItem('bestRound') || 1),
  isSpinning: false,
  featuredBuffId: null,
  worldBuff: null, // temporary global buff
};

// --- DOM HELPERS ---
const $ = id => document.getElementById(id);
const q = sel => document.querySelector(sel);

function playSfx(id) {
  try {
    const a = $(id);
    if (a && a.play) { a.currentTime = 0; a.play().catch(()=>{}); }
  } catch(e) {}
}

function updateHUD(msg = '', type = 'info') {
  $('round').textContent = state.round;
  $('spinsLeft').textContent = state.spinsLeft;
  $('balance').textContent = Math.max(0, Math.round(state.balance));
  $('debt').textContent = Math.max(0, Math.round(state.debt));
  $('bestRound').textContent = state.bestRound;
  $('spinCost').textContent = computeSpinCost();

  const buffs = state.activeBuffs.map(b => b.name);
  $('buffsSummary').textContent = buffs.length ? buffs.join(', ') : '—';

  $('worldBuff').textContent = state.worldBuff ? `${state.worldBuff.name} (до ${new Date(state.worldBuff.expires).toLocaleTimeString()})` : '—';
  const featured = BUFF_POOL.find(b=>b.id===state.featuredBuffId);
  $('featuredBuff').textContent = featured ? `${featured.name} — скидка!` : '—';

  setMessage(msg, type);

  $('payDebtBtn').disabled = !(state.spinsLeft === 0 && state.balance >= state.debt);
  const usedSpins = SPINS_PER_ROUND - state.spinsLeft;
  const allowOffer = (usedSpins - state.lastOfferSpin) >= OFFER_COOLDOWN_ROLLS && state.spinsLeft > 0 && !state.isSpinning;
  $('takeOfferBtn').disabled = !allowOffer;
  $('spinBtn').disabled = state.isSpinning || state.spinsLeft <= 0;

  renderShop();
}

function setMessage(text, type='info') {
  const el = $('message');
  el.textContent = text || '';
  el.className = 'message';
  if (!text) return;
  if (type === 'win') el.classList.add('win');
  else if (type === 'lose') el.classList.add('lose');
  else el.classList.add('info');
}

function weightedPick(items, weightFn) {
  let total = 0;
  for (const it of items) total += weightFn(it);
  let r = Math.random() * total;
  for (const it of items) {
    r -= weightFn(it);
    if (r <= 0) return it;
  }
  return items[items.length-1];
}

function computeSpinCost() {
  let disc = 0;
  for (const b of state.activeBuffs) disc += (b.effect.spinDiscount || 0);
  return Math.max(0, SPIN_COST - disc);
}

function luckAdjustedSymbols() {
  let extra = 0;
  for (const b of state.activeBuffs) extra += (b.effect.extraChance || 0);
  if (state.worldBuff && state.worldBuff.effect && state.worldBuff.effect.extraChance) extra += state.worldBuff.effect.extraChance;
  return SYMBOLS.map(s => ({ ...s, weight: s.weight * (((s.emoji==='🍀'||s.emoji==='💎') ? (1+extra) : 1)) }));
}

function payoutFor(result) {
  const [a,b,c] = result;
  let mult = 1;
  for (const bf of state.activeBuffs) mult *= (bf.effect.payoutMult || 1);
  if (state.worldBuff && state.worldBuff.effect && state.worldBuff.effect.payoutMult) mult *= state.worldBuff.effect.payoutMult;
  if (a === '🍀' && b === '🍀' && c === '🍀') {
    for (const bf of state.activeBuffs) mult *= (bf.effect.cloverMult || 1);
  }
  if (a===b && b===c) {
    const sym = SYMBOLS.find(s=>s.emoji===a);
    return Math.round((sym?.payout || 0) * mult);
  }
  if (a===b || b===c || a===c) return Math.round(5*mult);
  return 0;
}

// ---------- РЕАЛИСТИЧНАЯ АНИМАЦИЯ БАРАБАНОВ ----------
function spinReel(idx, finalEmoji, pool, duration) {
  return new Promise((resolve) => {
    const reel = document.querySelector(`.reel[data-idx="${idx}"]`);
    if (!reel) { resolve(); return; }
    const cell = reel.querySelector('.cell');
    reel.classList.remove('win');
    reel.classList.remove('glitch');
    let elapsed = 0;
    let delay = 35 + Math.random()*20;
    const maxDuration = duration;
    function tick() {
      const sym = weightedPick(pool, s => s.weight).emoji;
      cell.textContent = sym;
      delay *= 1.06 + Math.random()*0.02;
      elapsed += delay;
      if (elapsed < maxDuration) {
        setTimeout(tick, delay);
      } else {
        if (Math.random() < 0.25) reel.classList.add('glitch');
        setTimeout(()=> {
          cell.textContent = finalEmoji;
          reel.classList.add('stop-' + idx);
          resolve();
        }, 70 + Math.random()*80);
      }
    }
    reel.classList.add('spinning');
    setTimeout(tick, 0);
  });
}

async function animateReels(result) {
  state.isSpinning = true;
  playSfx('sfx-spin');

  const pool = luckAdjustedSymbols();
  const base = 900;
  const durations = [
    base + Math.round(Math.random()*200),
    base + 350 + Math.round(Math.random()*240),
    base + 700 + Math.round(Math.random()*300),
  ];

  await Promise.all([
    spinReel(0, result[0], pool, durations[0]),
    spinReel(1, result[1], pool, durations[1]),
    spinReel(2, result[2], pool, durations[2])
  ]);

  await new Promise(r => setTimeout(r, 90));
  state.isSpinning = false;
}

function flashMachine(type='red', duration=450) {
  const m = $('machine');
  if (!m) return;
  m.classList.add('flicker');
  if (type === 'red') m.classList.add('glitch');
  setTimeout(()=>{ m.classList.remove('flicker'); m.classList.remove('glitch'); }, duration);
}

// ---------- SHOP / ROTATION ----------
function pickFeaturedBuff() {
  const choices = BUFF_POOL.slice();
  const pick = choices[Math.floor(Math.random()*choices.length)];
  state.featuredBuffId = pick.id;
  updateHUD();
}
function rotateWorldBuff() {
  const rnd = Math.random();
  if (rnd < 0.55) {
    const opts = [
      { id: 'nightLuck', name: 'Ночь удачи', effect:{ extraChance: 0.08 }, duration: 22000 },
      { id: 'blessing', name: 'Благословение', effect:{ payoutMult: 1.15 }, duration: 25000 },
      { id: 'cloverHour', name: 'Час клевера', effect:{ cloverMult: 1.3 }, duration: 20000 },
    ];
    const pick = opts[Math.floor(Math.random()*opts.length)];
    const now = Date.now();
    state.worldBuff = { id: pick.id, name: pick.name, effect: pick.effect, expires: now + pick.duration };
    updateHUD(`${pick.name} активен!`, 'win');
    setTimeout(()=> {
      if (state.worldBuff && state.worldBuff.id === pick.id) {
        state.worldBuff = null;
        updateHUD('Мировой баф закончился.', 'info');
      }
    }, pick.duration + 80);
  } else {
    state.worldBuff = null;
    updateHUD('Нет мирового бафа сейчас.', 'info');
  }
  updateHUD();
}

function renderShop() {
  const container = $('shopItems');
  if (!container) return;
  container.innerHTML = '';
  for (const item of BUFF_POOL) {
    const owned = !!state.activeBuffs.find(b=>b.id===item.id);
    const isFeatured = state.featuredBuffId === item.id;
    const discount = isFeatured ? Math.round(item.shopPrice * 0.75) : item.shopPrice;
    const card = document.createElement('div');
    card.className = 'shop-card' + (owned ? ' bought' : '') + (isFeatured ? ' featured' : '');
    card.innerHTML = `
      <div class="shop-name">${item.name}</div>
      <div class="shop-desc">${item.desc || ''}</div>
      <div class="shop-price">
        <div class="price">Цена: <b>${discount}${isFeatured ? ' (акция)' : ''}</b></div>
        <div>
          <button class="btn buy-btn ${owned ? 'ghost' : 'primary'}" id="buy-${item.id}" ${owned ? 'disabled' : ''}>
            ${owned ? 'Куплено' : 'Купить'}
          </button>
        </div>
      </div>
    `;
    container.appendChild(card);
    (()=>{
      const btn = $(`buy-${item.id}`);
      if (btn) btn.addEventListener('click', ()=> buyItem(item.id, isFeatured ? discount : item.shopPrice));
    })();
  }
}

function buyItem(itemId, price) {
  const item = BUFF_POOL.find(b=>b.id===itemId);
  if (!item) return;
  if (state.activeBuffs.find(b=>b.id===itemId)) { updateHUD('Этот баф уже активен.','info'); return; }
  if (state.activeBuffs.length >= 3) { updateHUD('Максимум 3 активных бафа.','info'); return; }
  if (state.balance < price) { updateHUD('Не хватает денег для покупки.','info'); return; }
  state.balance -= price;
  state.activeBuffs.push(item);
  updateHUD(`Куплено: ${item.name}`, 'win');
  playSfx('sfx-win');
  renderShop();
  updateHUD();
}

// ---------- ОСНОВНАЯ ЛОГИКА ----------
async function spin() {
  if (state.isSpinning) return;
  if (state.spinsLeft <= 0) { updateHUD('Спины закончились. Погаси долг или готовься к последствиям…','info'); return; }
  const cost = computeSpinCost();
  if (state.balance < cost) { updateHUD('Недостаточно средств для спина.','info'); return; }

  state.balance -= cost;
  state.spinsLeft -= 1;
  updateHUD('Кручусь...','info');

  const pool = luckAdjustedSymbols();
  const r1 = weightedPick(pool, s=>s.weight).emoji;
  const r2 = weightedPick(pool, s=>s.weight).emoji;
  const r3 = weightedPick(pool, s=>s.weight).emoji;
  const result = [r1,r2,r3];

  await animateReels(result);

  const win = payoutFor(result);
  if (win > 0) {
    state.balance += win;
    document.querySelectorAll('.reel').forEach(r=>r.classList.add('win'));
    playSfx('sfx-win');
    updateHUD(`Выигрыш +${win}. Цена спина: ${cost}.`, 'win');
  } else {
    if (Math.random() < 0.12) flashMachine('red', 500);
    updateHUD(`Ничего… Цена спина: ${cost}.`, 'info');
  }

  if (state.spinsLeft === 0) {
    if (state.balance >= state.debt) {
      $('payDebtBtn').disabled = false;
      updateHUD('Раунд завершён. Можешь погасить долг сейчас.','info');
    } else {
      showOverlay('Раунд окончен. Денег не хватает для погашения долга. Последствия наступают...');
      playSfx('sfx-lose');
      flashMachine('red', 900);
    }
  }
  updateHUD();
}

function payDebt() {
  if (state.spinsLeft !== 0) return;
  if (state.balance < state.debt) return;
  state.balance -= state.debt;
  state.round += 1;
  state.spinsLeft = SPINS_PER_ROUND;
  state.debt += DEBT_GROWTH;

  if (Math.random()<0.6 && state.activeBuffs.length < 3) {
    const options = BUFF_POOL.filter(b=>!state.activeBuffs.find(x=>x.id===b.id));
    if (options.length) {
      const buff = options[Math.floor(Math.random()*options.length)];
      state.activeBuffs.push(buff);
      updateHUD(`Новый баф: ${buff.name}`,'win');
    } else updateHUD('Новый раунд! Все бафы уже собраны.','info');
  } else updateHUD('Новый раунд! Долг вырос.','info');

  state.bestRound = Math.max(state.bestRound, state.round);
  localStorage.setItem('bestRound', String(state.bestRound));
  $('payDebtBtn').disabled = true;
  updateHUD();
}

function phoneOffer() {
  const usedSpins = SPINS_PER_ROUND - state.spinsLeft;
  if ((usedSpins - state.lastOfferSpin) < OFFER_COOLDOWN_ROLLS) { updateHUD('Звонок пока недоступен...','info'); return; }
  state.lastOfferSpin = usedSpins;

  const entryFee = Math.max(5, Math.round(state.debt * 0.1));
  if (state.balance < entryFee) { updateHUD('Звонок оборвался… Недостаточно средств для сделки.','info'); return; }
  state.balance -= entryFee;

  const good = Math.random() < OFFER_CHANCE;
  if (good) {
    if (Math.random() < 0.5) {
      const reward = Math.round(state.debt * (0.6 + Math.random()*0.6));
      state.balance += reward;
      updateHUD(`Голос шепчет: «Дар свыше…» +${reward} монет.`,'win');
      playSfx('sfx-win');
    } else {
      const options = BUFF_POOL.filter(b=>!state.activeBuffs.find(x=>x.id===b.id));
      if (options.length) {
        const buff = options[Math.floor(Math.random()*options.length)];
        state.activeBuffs.push(buff);
        updateHUD(`Сделка заключена. Получен баф: ${buff.name}`,'win');
      } else {
        const reward = Math.round(30 + Math.random()*40);
        state.balance += reward;
        updateHUD(`Сделка: получено золото +${reward}.`,'win');
      }
    }
  } else {
    if (Math.random() < 0.6) {
      const extra = Math.round(10 + Math.random()*20);
      state.debt += extra;
      updateHUD(`Холодок по спине… Долг вырос ещё на +${extra}.`,'lose');
      flashMachine('red',700);
    } else {
      const fine = Math.round(10 + Math.random()*20);
      state.balance = Math.max(0, state.balance - fine);
      updateHUD(`Голос смеётся… Штраф −${fine}.`,'lose');
      playSfx('sfx-lose');
    }
  }
  updateHUD();
}

// ---------- OVERLAY & RESTART ----------
function showOverlay(text) {
  const ov = $('overlay');
  $('overlay-msg').textContent = text;
  ov.classList.remove('hidden');
  $('spinBtn').disabled = true;
  $('takeOfferBtn').disabled = true;
  $('payDebtBtn').disabled = true;
}
function hideOverlay() {
  const ov = $('overlay');
  ov.classList.add('hidden');
  if (state.spinsLeft === 0 && state.balance < state.debt) softRestartAfterLose();
  else updateHUD();
}
function softRestartAfterLose() {
  const machine = $('machine');
  machine.classList.add('flicker');
  setTimeout(()=>{
    state.round = 1;
    state.spinsLeft = SPINS_PER_ROUND;
    state.balance = START_BALANCE;
    state.debt = START_DEBT;
    state.activeBuffs = [];
    state.isSpinning = false;
    machine.classList.remove('flicker');
    updateHUD('Новая попытка. Сможешь дойти дальше?');
    $('spinBtn').disabled = false;
    $('takeOfferBtn').disabled = false;
  }, 900);
}

// ---------- TABS (UI) ----------
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.add('hidden'));
      document.getElementById('tab-'+tab).classList.remove('hidden');
      if (tab === 'shop') renderShop();
    });
  });
}

// ---------- INIT ----------
$('spinBtn').addEventListener('click', spin);
$('payDebtBtn').addEventListener('click', payDebt);
$('takeOfferBtn').addEventListener('click', phoneOffer);
$('resetBtn').addEventListener('click', ()=>{
  localStorage.removeItem('bestRound');
  state.bestRound = 1;
  state.round = 1;
  state.spinsLeft = SPINS_PER_ROUND;
  state.balance = START_BALANCE;
  state.debt = START_DEBT;
  state.activeBuffs = [];
  updateHUD('Прогресс очищен.');
});
$('overlay-ok').addEventListener('click', ()=>{ hideOverlay(); });
$('overlay-restart').addEventListener('click', ()=>{
  $('overlay').classList.add('hidden');
  state.round = 1;
  state.spinsLeft = SPINS_PER_ROUND;
  state.balance = START_BALANCE;
  state.debt = START_DEBT;
  state.activeBuffs = [];
  updateHUD('Перезапуск...');
});

// Telegram WebApp friendly: покажем имя пользователя (если игра запущена внутри Telegram)
function tryShowTelegramName() {
  try {
    if (window.Telegram && window.Telegram.WebApp) {
      const user = Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user;
      if (user && user.first_name) {
        setMessage(`Привет, ${user.first_name}! Удачи в КлеверПите.`, 'info');
      }
      // Telegram provides WebApp methods; calling ready helps layout sometimes
      if (Telegram.WebApp.ready) Telegram.WebApp.ready();
    }
  } catch (e) { /* ignore */ }
}

// initial UI
initTabs();
pickFeaturedBuff();
rotateWorldBuff();
renderShop();
tryShowTelegramName();
updateHUD('Добро пожаловать. Сделай ставку и крути.');

// schedule periodic rotations (no network)
setInterval(()=>{ pickFeaturedBuff(); }, 30000 + Math.floor(Math.random()*10000));
setInterval(()=>{ rotateWorldBuff(); }, 25000 + Math.floor(Math.random()*15000));
