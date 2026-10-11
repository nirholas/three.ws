#!/bin/bash
# Inspect DeFiLlama fees/revenue API field names

echo "=== QUERY 1: First protocol details ==="
curl -s 'https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true' | python3 -c "
import json, sys
data = json.load(sys.stdin)
protos = data.get('protocols', [])
print('Total protocols:', len(protos))
if protos:
    p = protos[0]
    print('First protocol name:', p.get('name'))
    print('All keys:', sorted(p.keys()))
    print()
    print('All numeric fields with values > 0:')
    for k, v in sorted(p.items()):
        if isinstance(v, (int, float)) and v > 0:
            print(f'  {k}: {v}')
    print()
    rev_keys = [k for k in p.keys() if 'rev' in k.lower() or 'fee' in k.lower() or '24h' in k.lower() or '30d' in k.lower() or '1d' in k.lower() or 'daily' in k.lower()]
    print('Revenue/fee related keys:', rev_keys)
    print()
    for pp in protos[:3]:
        print(f'Protocol: {pp.get(\"name\", \"?\")}')
        for k in rev_keys:
            print(f'  {k}: {pp.get(k)}')
"

echo ""
echo "=== QUERY 2: All unique keys across first 10 protocols ==="
curl -s 'https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true' | python3 -c "
import json, sys
data = json.load(sys.stdin)
protos = data.get('protocols', [])
all_keys = set()
for p in protos[:10]:
    all_keys.update(p.keys())
print('All unique keys:', sorted(all_keys))
for k in sorted(all_keys):
    vals = [p.get(k) for p in protos[:5] if p.get(k) is not None and p.get(k) != 0]
    if vals:
        print(f'  {k}: {vals[:3]}')
"
