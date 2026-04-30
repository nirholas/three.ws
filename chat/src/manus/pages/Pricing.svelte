<script>
  import Icon from '../../Icon.svelte';
  import { feCheck } from '../../feather.js';
  const plans = [
    { name: 'Free',     price: '$0',   suffix: '/mo', tag: 'Try Manus on small projects',
      features: ['50 messages / month','Single-agent runs','Community support'],
      cta: 'Get started', highlight: false },
    { name: 'Pro',      price: '$39',  suffix: '/mo', tag: 'For builders who ship daily',
      features: ['Unlimited messages','Multi-agent runs','Priority models','Email support'],
      cta: 'Start free trial', highlight: true },
    { name: 'Business', price: '$129', suffix: '/mo', tag: 'For teams running real workloads',
      features: ['Everything in Pro','Shared workspaces','SSO','SOC 2 reports','Dedicated CSM'],
      cta: 'Talk to sales', highlight: false },
  ];
  const faqs = [
    { q: 'Can I change plans later?',  a: 'Yes — upgrade, downgrade, or cancel any time.' },
    { q: 'Do you offer annual billing?', a: 'Annual billing is available with a 20% discount.' },
    { q: 'Is there a free trial of Pro?', a: '14 days, no credit card required.' },
    { q: 'How does enterprise pricing work?', a: 'Custom volume pricing — contact sales for a quote.' },
  ];
</script>

<section class="pt-20 pb-24">
  <h1 class="manus-display text-center">Simple pricing.<br/>Built for momentum.</h1>
  <p class="text-[#6B6B6B] text-lg max-w-[640px] text-center mx-auto mt-6">
    Start free. Upgrade when your team is ready to ship more.
  </p>

  <div class="max-w-[1100px] mx-auto px-6 mt-16 grid md:grid-cols-3 gap-6">
    {#each plans as p}
      <div class={'rounded-2xl p-8 flex flex-col border ' + (p.highlight
        ? 'bg-black text-white border-black'
        : 'bg-white text-[#1A1A1A] border-[#E5E3DC]')}>
        <div class="text-sm font-medium opacity-80">{p.name}</div>
        <div class="mt-2 flex items-baseline gap-1">
          <span class="font-serif text-5xl font-semibold">{p.price}</span>
          <span class={p.highlight ? 'text-white/60 text-base' : 'text-[#6B6B6B] text-base'}>{p.suffix}</span>
        </div>
        <div class={'mt-2 text-sm ' + (p.highlight ? 'text-white/70' : 'text-[#6B6B6B]')}>{p.tag}</div>
        <ul class="mt-6 space-y-2 text-sm">
          {#each p.features as f}
            <li class="flex items-center gap-2">
              <Icon icon={feCheck} size={14} />
              <span>{f}</span>
            </li>
          {/each}
        </ul>
        <button class={'mt-8 h-10 rounded-full text-sm font-medium ' + (p.highlight
          ? 'bg-white text-black hover:bg-white/90'
          : 'bg-black text-white hover:bg-[#1A1A1A]')}>{p.cta}</button>
      </div>
    {/each}
  </div>

  <div class="max-w-[760px] mx-auto px-6 mt-24">
    <h2 class="font-serif text-3xl font-semibold mb-6">Questions</h2>
    <div class="divide-y divide-[#E5E3DC] border-t border-[#E5E3DC]">
      {#each faqs as f}
        <details class="py-4">
          <summary class="cursor-pointer font-medium text-[#1A1A1A]">{f.q}</summary>
          <p class="mt-2 text-[#6B6B6B] text-sm">{f.a}</p>
        </details>
      {/each}
    </div>
  </div>
</section>
