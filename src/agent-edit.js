const API_BASE = '/api';
const agentId = new URLSearchParams(location.search).get('id');

const $ = (id) => document.getElementById(id);

let agentData = null;

async function loadAgent() {
  if (!agentId) {
    showError('No agent ID provided.');
    return;
  }
  try {
    const r = await fetch(`${API_BASE}/marketplace/agents/${agentId}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    agentData = j.data.agent;
    render();
  } catch (err) {
    showError(err.message);
  }
}

function render() {
  $('loading').hidden = true;
  $('panel-persona').classList.add('active');
  $('agent-title').textContent = `Edit Agent: ${agentData.name}`;
  $('back-link').href = `/agent-detail.html?id=${agentId}`;

  // Persona
  $('f-name').value = agentData.name;
  $('f-desc').value = agentData.description;

  // Publish
  $('f-category').value = agentData.category;
  $('f-tags').value = (agentData.tags || []).join(', ');
  $('f-prompt').value = agentData.system_prompt;
  $('f-greeting').value = agentData.greeting;

  // Monetization
  renderMonetization();
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

    return `
      <div class="skill-item" data-skill-name="${escapeHtml(skillName)}">
        <span class="skill-name">${escapeHtml(skillName)}</span>
        <div class="skill-pricing-controls">
          <label class="toggle-switch">
            <input type="checkbox" class="price-toggle" ${isPaid ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
          <div class="price-input-wrapper" style="display: ${isPaid ? 'flex' : 'none'};">
            <input type="number" class="price-input" min="0" step="0.01" placeholder="0.50" value="${amount}">
            <span>USDC</span>
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
      prices.push({
        skill,
        amount: Math.round(parseFloat(input.value) * 1e6),
        currency_mint: USDC_MINT,
        chain: 'solana',
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


document.querySelectorAll('.edit-tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    document.querySelectorAll('.edit-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.edit-panel').forEach(p => p.classList.remove('active'));
    
    const tabId = e.target.dataset.tab;
    e.target.classList.add('active');
    $(`panel-${tabId}`).classList.add('active');
  });
});

loadAgent();
