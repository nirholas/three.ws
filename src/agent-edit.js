function renderAgentForEditing(agent) {
  // ... existing code to render agent name, description, etc.

  const skillsContainer = document.getElementById('skills-editor');
  const skillPrices = agent.skill_prices || {};

  skillsContainer.innerHTML = agent.skills.map(skill => {
    const price = skillPrices[skill.name] || {};
    const amountInUnits = price.amount ? price.amount / 1e6 : ''; // Example for USDC (6 decimals)
    const currency = price.currency_mint || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6T'; // Default to USDC

    return `
      <div class="skill-price-editor" data-skill-name="${skill.name}">
        <span class="skill-name">${skill.name}</span>
        <input type="number" class="price-amount" placeholder="e.g., 2.50" value="${amountInUnits}">
        <select class="price-currency">
          <option value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6T" ${currency === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6T' ? 'selected' : ''}>USDC</option>
          <option value="So11111111111111111111111111111111111111112" ${currency === 'So11111111111111111111111111111111111111112' ? 'selected' : ''}>SOL</option>
        </select>
      </div>
    `;
  }).join('');
}

// Add event listener for the "Save Prices" button
document.getElementById('save-prices-btn').addEventListener('click', async () => {
  const agentId = /* get agent id from somewhere */;
  const editors = document.querySelectorAll('.skill-price-editor');
  
  for (const editor of editors) {
    const skill_name = editor.dataset.skillName;
    const amountInUnits = parseFloat(editor.querySelector('.price-amount').value);
    const currency_mint = editor.querySelector('.price-currency').value;

    if (!isNaN(amountInUnits) && amountInUnits > 0) {
      const amount = Math.round(amountInUnits * 1e6); // Convert back to smallest unit
      
      await fetch(`/api/agents/${agentId}/skills/pricing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', /* + auth headers */ },
        body: JSON.stringify({ skill_name, amount, currency_mint }),
      });
    }
  }
  // Show feedback to user
  alert('Prices saved!');
});
