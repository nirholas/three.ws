<script>
  import { route, loadCurrentUser } from '../../stores.js';
  import { signInWithEVM, signInWithSolana } from '../../walletAuth.js';

  export let kind = 'signin'; // 'signin' | 'signup'

  let email = '';
  let password = '';
  let name = '';
  let loading = null; // 'evm' | 'sol' | null
  let error = '';

  async function connectEVM() {
    error = '';
    loading = 'evm';
    try {
      await signInWithEVM();
      await loadCurrentUser();
      route.set('chat');
    } catch (e) {
      error = e.message || 'EVM sign-in failed.';
    } finally {
      loading = null;
    }
  }

  async function connectSolana() {
    error = '';
    loading = 'sol';
    try {
      await signInWithSolana();
      await loadCurrentUser();
      route.set('chat');
    } catch (e) {
      error = e.message || 'Solana sign-in failed.';
    } finally {
      loading = null;
    }
  }

  function submit() {
    // Email/password auth not yet implemented
    route.set('chat');
  }
</script>

<section class="pt-24 pb-16 px-6">
  <div class="bg-white border border-[#E5E3DC] rounded-2xl p-8 w-full max-w-[420px] mx-auto">
    <h1 class="font-serif text-3xl font-semibold text-center">
      {kind === 'signin' ? 'Welcome back' : 'Create your account'}
    </h1>
    <p class="text-[#6B6B6B] text-sm text-center mt-2">
      {kind === 'signin'
        ? 'Sign in to continue to three.ws'
        : 'Free to start. No credit card required.'}
    </p>

    <div class="mt-6 space-y-3">
      <button
        disabled={loading !== null}
        on:click={connectEVM}
        class="bg-black text-white rounded-xl h-11 w-full flex items-center justify-center gap-2 hover:bg-[#333] text-sm font-medium disabled:opacity-50 transition-colors"
      >
        {loading === 'evm' ? 'Connecting…' : 'Connect EVM Wallet'}
      </button>
      <button
        disabled={loading !== null}
        on:click={connectSolana}
        class="bg-white border border-[#E5E3DC] text-[#1A1A1A] rounded-xl h-11 w-full flex items-center justify-center gap-2 hover:bg-[#F5F4EF] text-sm font-medium disabled:opacity-50 transition-colors"
      >
        {loading === 'sol' ? 'Connecting…' : 'Connect Solana Wallet'}
      </button>
      {#if error}
        <p class="text-xs text-red-500 text-center">{error}</p>
      {/if}
    </div>

    <div class="flex items-center gap-3 text-xs text-[#9C9A93] my-4">
      <span class="flex-1 h-px bg-[#E5E3DC]" />or<span class="flex-1 h-px bg-[#E5E3DC]" />
    </div>

    <form class="space-y-3" on:submit|preventDefault={submit}>
      {#if kind === 'signup'}
        <label class="block">
          <span class="text-xs font-medium text-[#6B6B6B] mb-1.5 block">Name</span>
          <input class="w-full h-11 px-4 rounded-xl border border-[#E5E3DC] bg-white focus:outline-none focus:border-[#1A1A1A]"
                 type="text" bind:value={name} required>
        </label>
      {/if}
      <label class="block">
        <span class="text-xs font-medium text-[#6B6B6B] mb-1.5 block">Email</span>
        <input class="w-full h-11 px-4 rounded-xl border border-[#E5E3DC] bg-white focus:outline-none focus:border-[#1A1A1A]"
               type="email" bind:value={email} required>
      </label>
      <label class="block">
        <span class="text-xs font-medium text-[#6B6B6B] mb-1.5 block">Password</span>
        <input class="w-full h-11 px-4 rounded-xl border border-[#E5E3DC] bg-white focus:outline-none focus:border-[#1A1A1A]"
               type="password" bind:value={password} required minlength="8">
      </label>
      <button type="submit"
              class="w-full h-11 rounded-full bg-black text-white text-sm font-medium hover:bg-[#1A1A1A]">
        {kind === 'signin' ? 'Sign in' : 'Create account'}
      </button>
    </form>
  </div>

  <p class="text-center text-sm text-[#6B6B6B] mt-6">
    {#if kind === 'signin'}
      Don't have an account?
      <button class="text-[#1A1A1A] underline" on:click={() => route.set('signup')}>Sign up</button>
    {:else}
      Already have an account?
      <button class="text-[#1A1A1A] underline" on:click={() => route.set('signin')}>Sign in</button>
    {/if}
  </p>
</section>
