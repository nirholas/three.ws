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
  // This would save persona changes, not implemented in this task
});

$('publish-save').addEventListener('click', async () => {
  // This would save publish changes, not implemented in this task
});

$('monetization-save').addEventListener('click', async () => {
  const prices = [];
  document.querySelectorAll('#skill-prices-list .skill-item').forEach(item => {
    const name = item.dataset.skillName;
    const toggle = item.querySelector('.price-toggle');
    const input = item.querySelector('.price-input');
    
    if (toggle.checked && input.value) {
      const amountInLamports = parseFloat(input.value) * 1e6;
      prices.push({
        skill_name: name,
        amount: amountInLamports,
        currency_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6a'
      });
    }
  });

  try {
    const r = await fetch(`${API_BASE}/agents/${agentId}/skills-pricing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prices })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    $('monetization-status').textContent = 'Prices saved!';
    $('monetization-status').className = 'form-status ok';
  } catch (err) {
    $('monetization-status').textContent = `Error: ${err.message}`;
    $('monetization-status').className = 'form-status err';
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
