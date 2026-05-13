const API_BASE = '/api';
const params = new URLSearchParams(location.search);
const agentId = params.get('id');

// Avatar handoff from marketplace modal ("Start an agent with this avatar")
const initAvatarId  = params.get('avatar_id')  || null;
const initAvatarGlb = params.get('avatar_glb') || null;
const initAvatarName = params.get('avatar_name') || null;

const $ = (id) => document.getElementById(id);

let agentData = null;
let outfitMounted = false;
let availableAvatars = null;

async function loadAgent() {
  if (!agentId) {
    if (initAvatarId || initAvatarGlb) {
      await createAgentFromAvatar();
    } else {
      showError('No agent ID provided.');
    }
    return;
  }
  try {
    const r = await fetch(`${API_BASE}/agents/${agentId}`, { credentials: 'include' });
    if (r.status === 401) {
      sessionStorage.setItem('login_redirect', location.href);
      location.replace('/login');
      return;
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
    }
    const j = await r.json();
    agentData = j.agent;
    if (!agentData) throw new Error('agent not in response');
    render();
  } catch (err) {
    showError(err.message);
  }
}

async function createAgentFromAvatar() {
  showLoading('Creating agent…');
  try {
    const name = initAvatarName ? `${initAvatarName} Agent` : 'My Agent';
    const createRes = await fetch(`${API_BASE}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name }),
    });
    if (!createRes.ok) {
      const j = await createRes.json().catch(() => ({}));
      if (createRes.status === 401) {
        sessionStorage.setItem('login_redirect', location.href);
        location.replace('/login');
        return;
      }
      throw new Error(j.error_description || `HTTP ${createRes.status}`);
    }
    const { agent } = await createRes.json();

    if (initAvatarId) {
      const patchRes = await fetch(`${API_BASE}/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ avatar_id: initAvatarId }),
      });
      if (!patchRes.ok) {
        console.warn('[agent-edit] avatar attach failed', patchRes.status);
      }
    }

    history.replaceState({}, '', `/agent-edit.html?id=${agent.id}`);
    agentData = agent;
    if (initAvatarName) {
      agentData.name = name;
      agentData.system_prompt = agentData.system_prompt ||
        `You are ${initAvatarName}, a 3D avatar agent. Be helpful and engaging.`;
    }
    render();
    showBanner(`Agent created from "${initAvatarName || 'avatar'}" — fill in the details below.`);
  } catch (err) {
    showError(err.message);
  }
}

function showLoading(msg) {
  const el = $('loading');
  if (el) { el.hidden = false; el.textContent = msg; }
}

function showBanner(msg) {
  let el = $('avatar-origin-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'avatar-origin-banner';
    el.style.cssText =
      'padding:10px 20px;background:rgba(125,211,252,.1);border-bottom:1px solid rgba(125,211,252,.25);' +
      'color:#7dd3fc;font-size:13px;font-weight:500;';
    document.body.prepend(el);
  }
  el.textContent = msg;
}

function render() {
  $('loading').hidden = true;
  // Reveal the persona panel (the rest stay [hidden] until their tab is opened).
  $('panel-persona').hidden = false;
  $('panel-persona').classList.add('active');
  $('agent-title').textContent = `Edit Agent: ${agentData.name || 'Untitled'}`;
  $('back-link').href = `/agent-detail.html?id=${agentId}`;

  // Persona
  $('f-name').value = agentData.name || '';
  $('f-desc').value = agentData.description || '';

  // Publish
  $('f-category').value = agentData.category || '';
  $('f-tags').value = (agentData.tags || []).join(', ');
  $('f-prompt').value = agentData.system_prompt || '';
  $('f-greeting').value = agentData.greeting || '';

  // Monetization
  renderMonetization();

  // Autopilot
  $('f-strategy').value = formatStrategy(agentData.meta?.strategy);
}

function formatStrategy(strategy) {
  if (strategy == null) return '';
  if (typeof strategy === 'string') return strategy;
  try { return JSON.stringify(strategy, null, 2); } catch { return String(strategy); }
}

function parseStrategy(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // If it parses as JSON, store as object; otherwise as plain string (freeform).
  try { return JSON.parse(trimmed); } catch { return trimmed; }
}

function renderMonetization() {
  const container = $('skill-prices-list');
  const skills = agentData.skills || [];
  if (!skills.length) {
    container.innerHTML = '<div class="muted">This agent has no skills.</div>';
    return;
  }

  const skillPrices = agentData.skill_prices || {};

  container.innerHTML = skills.map(skill => {
    const skillName = typeof skill === 'string' ? skill : skill.name;
    const price = skillPrices[skillName];
    const isPaid = !!price;
    const amount = isPaid ? (price.amount / 1e6).toFixed(2) : '';
    const trialUses = isPaid ? (price.trial_uses ?? 0) : 0;

    return `
      <div class="skill-item" data-skill-name="${escapeHtml(skillName)}">
        <span class="skill-name">${escapeHtml(skillName)}</span>
        <div class="skill-pricing-controls">
          <label class="toggle-switch">
            <input type="checkbox" class="price-toggle" ${isPaid ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
          <div class="price-input-wrapper" style="display: ${isPaid ? 'flex' : 'none'}; align-items:center; gap:8px;">
            <input type="number" class="price-input" min="0" step="0.01" placeholder="0.50" value="${amount}">
            <span>USDC</span>
            <label style="font-size:12px;color:#a1a1aa;margin-left:8px;white-space:nowrap">
              Free trials:
              <input type="number" class="trial-uses-input" min="0" max="10" step="1" placeholder="0" value="${trialUses}" style="width:52px;margin-left:4px">
            </label>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.price-toggle').forEach(toggle => {
    toggle.addEventListener('change', (e) => {
      const wrapper = e.target.closest('.skill-pricing-controls').querySelector('.price-input-wrapper');
      wrapper.style.display = e.target.checked ? 'flex' : 'none';
    });
  });
}

// ── Outfit tab ────────────────────────────────────────────────────────────
// Lazily mount the agent preview + avatar picker only when the user opens
// the tab so we don't pay for a WebGL context up front.

async function ensureOutfitTab() {
  if (outfitMounted) return;
  outfitMounted = true;

  const preview = $('outfit-preview');
  const a3d = document.createElement('agent-3d');
  a3d.setAttribute('agent-id', agentId);
  a3d.setAttribute('controls', 'orbit');
  a3d.style.cssText = 'width:100%;height:100%;display:block';
  preview.innerHTML = '';
  preview.appendChild(a3d);

  await renderAvatarList();
}

async function renderAvatarList() {
  const container = $('avatar-picker-list');
  container.textContent = 'Loading avatars…';
  try {
    const r = await fetch(`${API_BASE}/avatars?limit=50`, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    availableAvatars = j.avatars || [];
  } catch (err) {
    container.innerHTML = `<div class="error-msg" style="padding:1rem">Could not load avatars: ${escapeHtml(err.message)}</div>`;
    return;
  }

  if (!availableAvatars.length) {
    container.innerHTML = '<div class="no-named-mats">You have no avatars yet. <a href="/dashboard/#avatars" style="color:#93c5fd">Create one in the dashboard ›</a></div>';
    return;
  }

  container.innerHTML = availableAvatars.map((av) => {
    const thumb = av.thumbnail_url || av.url || '';
    const isCurrent = av.id === agentData.avatar_id;
    return `
      <button type="button" class="avatar-tile${isCurrent ? ' current' : ''}" data-avatar-id="${escapeHtml(av.id)}" title="${escapeHtml(av.name || av.id)}">
        ${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy">` : '<div class="avatar-tile-ph">3D</div>'}
        <span class="avatar-tile-name">${escapeHtml(av.name || 'Untitled')}</span>
        ${isCurrent ? '<span class="avatar-tile-badge">Current</span>' : ''}
      </button>
    `;
  }).join('');

  container.querySelectorAll('.avatar-tile').forEach((btn) => {
    btn.addEventListener('click', () => selectAvatar(btn.dataset.avatarId));
  });
}

async function selectAvatar(avatarId) {
  if (!avatarId || avatarId === agentData.avatar_id) return;
  const status = $('outfit-status');
  status.textContent = 'Saving…';
  status.className = 'outfit-status saving';
  try {
    const r = await fetch(`${API_BASE}/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ avatar_id: avatarId }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
    }
    agentData.avatar_id = avatarId;
    // Re-render the avatar tiles so the "Current" badge moves, and reload the
    // 3D preview so the new model paints.
    await renderAvatarList();
    reloadOutfitPreview();
    status.textContent = 'Saved.';
    status.className = 'outfit-status saved';
    setTimeout(() => { status.textContent = ''; status.className = 'outfit-status'; }, 2000);
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'outfit-status err';
  }
}

function reloadOutfitPreview() {
  const preview = $('outfit-preview');
  const a3d = document.createElement('agent-3d');
  a3d.setAttribute('agent-id', agentId);
  a3d.setAttribute('controls', 'orbit');
  a3d.style.cssText = 'width:100%;height:100%;display:block';
  preview.innerHTML = '';
  preview.appendChild(a3d);
}

function showError(msg) {
  $('loading').hidden = true;
  const errEl = $('error');
  errEl.textContent = `Error: ${msg}`;
  errEl.hidden = false;
}

function escapeHtml(s) {
  return String(s || '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

// --- Event Listeners ---

$('persona-save').addEventListener('click', async () => {
  const status = $('persona-status');
  const name = $('f-name').value.trim();
  const description = $('f-desc').value.trim();
  if (!name) {
    status.textContent = 'Name is required.';
    status.className = 'form-status err';
    return;
  }
  status.textContent = 'Saving…';
  status.className = 'form-status';
  try {
    const r = await fetch(`${API_BASE}/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, description }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
    }
    const j = await r.json();
    if (j.agent) {
      agentData.name = j.agent.name;
      agentData.description = j.agent.description;
      $('agent-title').textContent = `Edit Agent: ${agentData.name}`;
    }
    status.textContent = 'Saved.';
    status.className = 'form-status ok';
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'form-status err';
  }
});

$('publish-save').addEventListener('click', async () => {
  const status = $('publish-status');
  const category = $('f-category').value.trim();
  const tags = $('f-tags').value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12);
  const system_prompt = $('f-prompt').value.trim();
  const greeting = $('f-greeting').value.trim();
  const changelog = $('f-changelog').value.trim() || null;

  if (!category) {
    status.textContent = 'Pick a category.';
    status.className = 'form-status err';
    return;
  }
  if (!system_prompt) {
    status.textContent = 'Agent profile (system prompt) is required.';
    status.className = 'form-status err';
    return;
  }

  status.textContent = 'Publishing…';
  status.className = 'form-status';
  try {
    const r = await fetch(`${API_BASE}/marketplace/agents/${agentId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ category, tags, system_prompt, greeting, changelog }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
    }
    const ver = j.data?.version;
    status.textContent = ver ? `Published v${ver}.` : 'Published.';
    status.className = 'form-status ok';
    const view = $('publish-view');
    if (view) {
      view.href = `/marketplace.html#${agentId}`;
      view.hidden = false;
    }
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'form-status err';
  }
});

// Solana mainnet USDC.
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

$('monetization-save').addEventListener('click', async () => {
  const prices = [];
  document.querySelectorAll('#skill-prices-list .skill-item').forEach((item) => {
    const skill = item.dataset.skillName;
    const toggle = item.querySelector('.price-toggle');
    const input = item.querySelector('.price-input');

    if (toggle.checked && input.value) {
      const trialInput = item.querySelector('.trial-uses-input');
      const trialUses = trialInput ? Math.max(0, Math.min(10, parseInt(trialInput.value || '0', 10) || 0)) : 0;
      prices.push({
        skill,
        amount: Math.round(parseFloat(input.value) * 1e6),
        currency_mint: USDC_MINT,
        chain: 'solana',
        trial_uses: trialUses,
      });
    }
  });

  const status = $('monetization-status');
  try {
    const r = await fetch(`${API_BASE}/agents/${agentId}/skills-pricing`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ prices }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
    }
    status.textContent = 'Prices saved.';
    status.className = 'form-status ok';
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'form-status err';
  }
});

$('autopilot-save').addEventListener('click', async () => {
  const status = $('autopilot-status');
  const text = $('f-strategy').value;
  status.textContent = 'Saving…';
  status.className = 'form-status';
  try {
    const strategy = parseStrategy(text);
    const r = await fetch(`${API_BASE}/agent-strategy?id=${encodeURIComponent(agentId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ strategy }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
    }
    agentData.meta = agentData.meta || {};
    agentData.meta.strategy = strategy;
    status.textContent = 'Strategy saved.';
    status.className = 'form-status ok';
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'form-status err';
  }
});

// --- Tab switching ---

document.querySelectorAll('.edit-tab').forEach((tab) => {
  tab.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const tabId = btn.dataset.tab;

    document.querySelectorAll('.edit-tab').forEach((t) => {
      const active = t === btn;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    document.querySelectorAll('.edit-panel').forEach((p) => {
      const active = p.id === `panel-${tabId}`;
      p.classList.toggle('active', active);
      if (active) p.removeAttribute('hidden');
      else p.setAttribute('hidden', '');
    });

    if (tabId === 'outfit' && agentData) ensureOutfitTab();
  });
});

loadAgent();
