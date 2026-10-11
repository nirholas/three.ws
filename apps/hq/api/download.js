export const config = { runtime: 'edge' };
import { UA_BOT } from './_ua.js';

const RELEASES_URL = 'https://api.github.com/repos/nirholas/three.ws/releases/latest';
const RELEASES_PAGE = 'https://github.com/nirholas/three.ws/releases/latest';

const PLATFORM_PATTERNS = {
  'windows-exe': (name) => name.endsWith('_x64-setup.exe'),
  'windows-msi': (name) => name.endsWith('_x64_en-US.msi'),
  'macos-arm64': (name) => name.endsWith('_aarch64.dmg'),
  'macos-x64': (name) => name.endsWith('_x64.dmg') && !name.includes('setup'),
};

export default async function handler(req) {
  const url = new URL(req.url);
  const platform = url.searchParams.get('platform');

  if (!platform || !PLATFORM_PATTERNS[platform]) {
    return Response.redirect(RELEASES_PAGE, 302);
  }

  try {
    const res = await fetch(RELEASES_URL, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': UA_BOT,
      },
    });

    if (!res.ok) {
      return Response.redirect(RELEASES_PAGE, 302);
    }

    const release = await res.json();
    const matcher = PLATFORM_PATTERNS[platform];
    const asset = release.assets?.find((a) => matcher(a.name));

    if (!asset) {
      return Response.redirect(RELEASES_PAGE, 302);
    }

    return new Response(null, {
      status: 302,
      headers: {
        'Location': asset.browser_download_url,
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch {
    return Response.redirect(RELEASES_PAGE, 302);
  }
}
