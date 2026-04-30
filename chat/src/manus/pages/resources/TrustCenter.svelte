<script>
  const stats = [
    { label: 'SOC 2 Type II', detail: 'Audited annually by an independent third party.' },
    { label: 'GDPR Ready', detail: 'Data processing agreements available for EU customers.' },
    { label: '99.95% SLA', detail: 'Uptime commitment backed by service credits.' },
  ];

  const sections = [
    {
      title: 'Data handling',
      body: 'All data in transit is encrypted with TLS 1.3. Data at rest uses AES-256 encryption. We do not use customer data to train models. Retention windows are configurable per workspace, with hard-delete available on request.',
    },
    {
      title: 'Access controls',
      body: 'Role-based access control (RBAC) is available on all Business plans. SSO via SAML 2.0 and OIDC is supported. All user sessions are time-limited and MFA is enforced for admin roles.',
    },
    {
      title: 'Subprocessors',
      body: 'We maintain a current list of subprocessors. Customers on Business plans receive advance notice of any subprocessor changes and have the right to object. Our core infrastructure runs on AWS (us-east-1, eu-west-1).',
    },
    {
      title: 'Vulnerability disclosure',
      body: 'We operate a responsible disclosure program. Security researchers can report issues to security@manus.ai. Critical vulnerabilities are acknowledged within 24 hours and patched within 7 days where possible.',
    },
  ];

  const badges = ['SOC 2', 'ISO 27001', 'HIPAA', 'GDPR', 'CCPA', 'PCI'];
</script>

<div class="max-w-[1100px] mx-auto px-6 pt-16 pb-24">
  <h1 class="font-serif text-4xl font-semibold mb-2">Trust Center</h1>
  <p class="text-[#6B6B6B] text-base mb-12">Security, privacy, and compliance at Manus</p>

  <!-- Stats row -->
  <div class="grid md:grid-cols-3 gap-4 mb-10">
    {#each stats as s}
      <div class="bg-white border border-[#E5E3DC] rounded-2xl p-6">
        <div class="font-serif text-2xl font-semibold text-[#1A1A1A] mb-1">{s.label}</div>
        <p class="text-sm text-[#6B6B6B]">{s.detail}</p>
      </div>
    {/each}
  </div>

  <!-- Content sections -->
  <div class="grid md:grid-cols-2 gap-4 mb-14">
    {#each sections as s}
      <div class="bg-white border border-[#E5E3DC] rounded-2xl p-6">
        <h2 class="font-serif text-xl font-semibold mb-3 text-[#1A1A1A]">{s.title}</h2>
        <p class="text-sm text-[#6B6B6B] leading-relaxed">{s.body}</p>
      </div>
    {/each}
  </div>

  <!-- Compliance badge grid -->
  <h2 class="font-serif text-2xl font-semibold mb-6 text-[#1A1A1A]">Certifications &amp; frameworks</h2>
  <div class="grid grid-cols-3 md:grid-cols-6 gap-4">
    {#each badges as b}
      <div class="bg-[#F5F4EF] border border-[#E5E3DC] rounded-xl aspect-square flex items-center justify-center">
        <span class="text-xs font-semibold text-[#6B6B6B] text-center px-2">{b}</span>
      </div>
    {/each}
  </div>
</div>
