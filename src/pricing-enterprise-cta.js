/**
 * /pricing "Buying for a company?" row. Links the Microsoft Marketplace offer
 * once data/enterprise.json has its offer_url, and /enterprise until then
 * (src/enterprise-model.js pricingCompanyLink, tests/enterprise.test.js).
 */

import enterprise from '../data/enterprise.json';
import { pricingCompanyLink } from './enterprise-model.js';

const cta = document.getElementById('pricing-company-cta');
if (cta) {
	const { href, label, external } = pricingCompanyLink(enterprise);
	cta.href = href;
	cta.textContent = label;
	if (external) {
		cta.target = '_blank';
		cta.rel = 'noopener';
	}
}
