#!/bin/bash
# RSS Feed URL checker for crypto/DeFi sites
# Run: bash scripts/check-rss.sh

check_url() {
  local url="$1"
  local code=$(curl -sI -L -o /dev/null -w "%{http_code}" --max-time 10 --connect-timeout 5 "$url" 2>/dev/null)
  printf "  %-65s → %s\n" "$url" "$code"
}

scan_html() {
  local url="$1"
  echo "  HTML scan of $url:"
  local result=$(curl -sL --max-time 10 --connect-timeout 5 -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" "$url" 2>/dev/null | grep -ioE '(application/rss\+xml|application/atom\+xml|type="application/xml"|href="[^"]*\b(feed|rss|atom)\b[^"]*")' | head -10)
  if [ -n "$result" ]; then
    echo "$result" | sed 's/^/    /'
  else
    echo "    (no RSS/Atom links found in HTML)"
  fi
}

UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

echo "================================================================"
echo "RSS FEED URL RESEARCH - $(date)"
echo "================================================================"

echo ""
echo "========== 1. DL News =========="
for path in /feed/ /feed /rss /rss.xml /feed.xml /blog/feed /atom.xml; do
  check_url "https://www.dlnews.com${path}"
done
check_url "https://dlnews.com/feed/"
scan_html "https://www.dlnews.com"

echo ""
echo "========== 2. CryptoSlate =========="
for path in /feed/ /feed /rss /rss.xml /feed.xml /atom.xml /blog/feed /news/feed; do
  check_url "https://cryptoslate.com${path}"
done
scan_html "https://cryptoslate.com"

echo ""
echo "========== 3. Bankless =========="
check_url "https://newsletter.banklesshq.com/feed"
for path in /feed /feed/ /rss /rss.xml /feed.xml /blog/feed /blog/rss; do
  check_url "https://bankless.com${path}"
  check_url "https://www.bankless.com${path}"
done
scan_html "https://bankless.com"
scan_html "https://www.bankless.com"

echo ""
echo "========== 4. DefiLlama =========="
for path in /feed /rss /rss.xml /feed.xml /atom.xml /blog/feed; do
  check_url "https://defillama.com${path}"
done
scan_html "https://defillama.com"

echo ""
echo "========== 5. DeFi Pulse =========="
for path in /blog/feed/ /feed /rss /rss.xml /feed.xml /blog/rss; do
  check_url "https://defipulse.com${path}"
done
check_url "https://www.defipulse.com/feed"
scan_html "https://defipulse.com"

echo ""
echo "========== 6. Daily DeFi =========="
for path in /feed/ /feed /rss /rss.xml /feed.xml /atom.xml /blog/feed; do
  check_url "https://dailydefi.org${path}"
done
scan_html "https://dailydefi.org"

echo ""
echo "========== 7. Uniswap =========="
check_url "https://uniswap.org/blog/feed.xml"
for path in /blog/feed /blog/rss /blog/rss.xml /blog/atom.xml /feed /rss /feed.xml /rss.xml; do
  check_url "https://uniswap.org${path}"
done
scan_html "https://uniswap.org/blog"
scan_html "https://uniswap.org"

echo ""
echo "========== 8. Aave =========="
check_url "https://aave.mirror.xyz/feed/atom"
for path in /feed /rss /feed.xml /rss.xml /atom.xml; do
  check_url "https://aave.mirror.xyz${path}"
done
for path in /feed /rss /blog/feed /feed.xml /rss.xml; do
  check_url "https://aave.com${path}"
done
for path in /feed /rss /feed.xml; do
  check_url "https://governance.aave.com${path}"
done
scan_html "https://aave.mirror.xyz"
scan_html "https://aave.com"

echo ""
echo "========== 9. MakerDAO / Sky =========="
check_url "https://blog.makerdao.com/feed/"
for path in /feed /rss /rss.xml /feed.xml; do
  check_url "https://blog.makerdao.com${path}"
done
for path in /feed /rss /blog/feed /feed.xml /rss.xml; do
  check_url "https://sky.money${path}"
  check_url "https://www.sky.money${path}"
done
for path in /feed /rss /feed.xml; do
  check_url "https://blog.sky.money${path}"
done
scan_html "https://blog.makerdao.com"
scan_html "https://sky.money"

echo ""
echo "========== 10. Yearn Finance =========="
check_url "https://blog.yearn.finance/feed"
for path in /feed /rss /rss.xml /feed.xml /atom.xml; do
  check_url "https://blog.yearn.finance${path}"
done
for path in /feed /rss /blog/feed /feed.xml; do
  check_url "https://yearn.finance${path}"
done
for path in /feed /rss /feed.xml; do
  check_url "https://medium.com/iearn${path}"
done
scan_html "https://blog.yearn.finance"
scan_html "https://yearn.finance"

echo ""
echo "========== 11. Optimism =========="
check_url "https://blog.optimism.io/rss/"
for path in /rss /feed /feed.xml /rss.xml /atom.xml; do
  check_url "https://blog.optimism.io${path}"
done
for path in /feed /rss /blog/feed /feed.xml; do
  check_url "https://optimism.io${path}"
done
# Optimism might use Medium or Mirror
for path in /feed /rss; do
  check_url "https://optimism.mirror.xyz${path}"
done
scan_html "https://blog.optimism.io"
scan_html "https://optimism.io"

echo ""
echo "========== 12. L2Beat =========="
check_url "https://l2beat.com/feed"
for path in /feed /rss /rss.xml /feed.xml /atom.xml /blog/feed; do
  check_url "https://l2beat.com${path}"
done
for path in /feed /rss /feed.xml; do
  check_url "https://medium.com/l2beat${path}"
done
scan_html "https://l2beat.com"

echo ""
echo "========== 13. Etherscan =========="
check_url "https://etherscan.io/blog?rss"
for path in "/blog/feed" "/blog/rss" "/feed" "/rss" "/rss.xml" "/feed.xml" "/blog?format=rss"; do
  check_url "https://etherscan.io${path}"
done
scan_html "https://etherscan.io"
scan_html "https://etherscan.io/blog"

echo ""
echo "========== 14. Phantom =========="
check_url "https://phantom.app/blog/rss.xml"
for path in /blog/feed /blog/rss /blog/feed.xml /blog/atom.xml /feed /rss /feed.xml /rss.xml; do
  check_url "https://phantom.app${path}"
done
# Phantom might use phantom.com now
for path in /blog/rss.xml /blog/feed /feed /rss; do
  check_url "https://phantom.com${path}"
done
scan_html "https://phantom.app"
scan_html "https://phantom.app/blog"

echo ""
echo "========== 15. Lightning Labs =========="
check_url "https://lightning.engineering/feed"
for path in /feed /rss /rss.xml /feed.xml /atom.xml /blog/feed; do
  check_url "https://lightning.engineering${path}"
done
for path in /feed /rss /feed.xml; do
  check_url "https://lightninglabs.substack.com${path}"
done
scan_html "https://lightning.engineering"

echo ""
echo "========== 16. Compass Mining =========="
check_url "https://compassmining.io/education/feed/"
for path in /education/feed /education/rss /feed /rss /rss.xml /feed.xml /blog/feed; do
  check_url "https://compassmining.io${path}"
done
scan_html "https://compassmining.io"
scan_html "https://compassmining.io/education"

echo ""
echo "========== 17. Rekt News =========="
check_url "https://rekt.news/rss.xml"
check_url "https://rekt.news/rss/feed.xml"
for path in /feed /rss /feed.xml /atom.xml /rss/; do
  check_url "https://rekt.news${path}"
done
scan_html "https://rekt.news"

echo ""
echo "================================================================"
echo "RESEARCH COMPLETE"
echo "================================================================"
