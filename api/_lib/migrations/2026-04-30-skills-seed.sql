-- Migration: skills marketplace seed data
-- Inserts 15 ready-to-use skills into marketplace_skills.
-- All rows: author_id = null (system skills), is_public = true.
-- Idempotent via ON CONFLICT (slug) DO NOTHING.

begin;

insert into marketplace_skills (name, slug, description, category, tags, schema_json, is_public, author_id) values

(
  'TradingView Charts',
  'tradingview-charts',
  'Display interactive TradingView price charts for any symbol including crypto, stocks, and forex.',
  'finance',
  '{"charts","trading","crypto","stocks"}',
  '[{"clientDefinition":{"id":"tradingview-chart-001","name":"TradingViewChart","description":"Displays an interactive TradingView chart for a given symbol.","arguments":[{"name":"symbol","type":"string","description":"Trading symbol e.g. BINANCE:BTCUSDT, NASDAQ:AAPL"},{"name":"interval","type":"string","description":"Chart interval: 1, 5, 15, 30, 60, D, W, M"},{"name":"theme","type":"string","description":"light or dark"}],"body":"const symbol = args.symbol || ''BINANCE:BTCUSDT'';\nconst interval = args.interval || ''D'';\nconst theme = args.theme || ''light'';\nconst html = `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;height:100%;overflow:hidden}</style></head><body><div id=\"tv_chart\" style=\"width:100%;height:100vh\"></div><script src=\"https://s3.tradingview.com/tv.js\"><\\/script><script>new TradingView.widget({container_id:\"tv_chart\",symbol:${JSON.stringify(symbol)},interval:${JSON.stringify(interval)},theme:${JSON.stringify(theme)},style:\"1\",width:\"100%\",height:\"100%\",toolbar_bg:\"#f1f3f6\",hide_side_toolbar:false,allow_symbol_change:true});<\\/script></body></html>`;\nreturn { contentType: ''text/html'', content: html };"},"type":"function","function":{"name":"TradingViewChart","description":"Display an interactive TradingView chart. Use for any request to show a price chart, candlestick chart, or market data visualization.","parameters":{"type":"object","properties":{"symbol":{"type":"string","description":"Trading symbol e.g. BINANCE:BTCUSDT, NASDAQ:AAPL, FX:EURUSD"},"interval":{"type":"string","enum":["1","5","15","30","60","D","W","M"],"description":"Chart interval"},"theme":{"type":"string","enum":["light","dark"],"description":"Chart theme"}},"required":["symbol"]}}}]',
  true,
  null
),

(
  'Web Search',
  'web-search',
  'Search the web via DuckDuckGo and return an abstract and top related topics.',
  'utility',
  '{"search","web","duckduckgo"}',
  '[{"clientDefinition":{"id":"pack-websearch-001","name":"WebSearch","description":"Search the web via DuckDuckGo.","arguments":[{"name":"query","type":"string","description":"Search query"}],"body":"const res = await fetch(''https://api.duckduckgo.com/?q='' + encodeURIComponent(args.query) + ''&format=json&no_html=1'');\nconst d = await res.json();\nconst topics = (d.RelatedTopics || []).slice(0, 3).map(t => t.Text).filter(Boolean);\nreturn JSON.stringify({ abstract: d.AbstractText || '''', topics });"},"type":"function","function":{"name":"WebSearch","description":"Search the web via DuckDuckGo and return an abstract and top related topics.","parameters":{"type":"object","properties":{"query":{"type":"string","description":"Search query"}},"required":["query"]}}}]',
  true,
  null
),

(
  'QR Code Generator',
  'qr-code',
  'Render a QR code image for any URL or text using the qrserver.com API.',
  'utility',
  '{"qr","barcode","encode"}',
  '[{"clientDefinition":{"id":"qr-code-001","name":"QRCode","description":"Renders a QR code image for any text or URL.","arguments":[{"name":"text","type":"string","description":"Text or URL to encode"},{"name":"size","type":"number","description":"Size in pixels (default 200)"}],"body":"const t = encodeURIComponent(args.text || '''');\nconst s = args.size || 200;\nconst src = `https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&data=${t}`;\nconst html = `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#fff}</style></head><body><img src=\"${src}\" alt=\"QR code\" style=\"max-width:100%;height:auto\" /></body></html>`;\nreturn { contentType: ''text/html'', content: html };"},"type":"function","function":{"name":"QRCode","description":"Generate and display a QR code for any text or URL.","parameters":{"type":"object","properties":{"text":{"type":"string","description":"Text or URL to encode in the QR code"},"size":{"type":"number","description":"Image size in pixels, default 200"}},"required":["text"]}}}]',
  true,
  null
),

(
  'Calculator',
  'calculator',
  'Evaluate mathematical expressions safely without using eval.',
  'utility',
  '{"math","calculate","expression"}',
  '[{"clientDefinition":{"id":"calculator-001","name":"Calculator","description":"Evaluates a mathematical expression and returns the result.","arguments":[{"name":"expression","type":"string","description":"Math expression to evaluate, e.g. 2 + 2 * 3"}],"body":"try {\n  const result = new Function(''return ('' + args.expression + '')'')();\n  if (typeof result !== ''number'' || !isFinite(result)) throw new Error(''Result is not a finite number'');\n  return { expression: args.expression, result };\n} catch (e) {\n  return { expression: args.expression, error: e.message };\n}"},"type":"function","function":{"name":"Calculator","description":"Evaluate a mathematical expression and return the numeric result. Use for arithmetic, percentages, or any calculation the user needs.","parameters":{"type":"object","properties":{"expression":{"type":"string","description":"Mathematical expression, e.g. \"(10 + 5) * 3 / 2\""}},"required":["expression"]}}}]',
  true,
  null
),

(
  'Markdown Preview',
  'markdown-preview',
  'Render user-supplied Markdown as styled HTML in a live preview iframe.',
  'productivity',
  '{"markdown","preview","render","docs"}',
  '[{"clientDefinition":{"id":"markdown-preview-001","name":"MarkdownPreview","description":"Renders Markdown text as styled HTML.","arguments":[{"name":"markdown","type":"string","description":"Markdown text to render"}],"body":"const md = args.markdown || '''';\n// Simple markdown-to-html: headers, bold, italic, code, lists, links\nfunction mdToHtml(s) {\n  return s\n    .replace(/&/g, ''&amp;'').replace(/</g, ''&lt;'').replace(/>/g, ''&gt;'')\n    .replace(/```([\\s\\S]*?)```/g, (_, c) => `<pre><code>${c.trim()}</code></pre>`)\n    .replace(/`([^`]+)`/g, ''<code>$1</code>'')\n    .replace(/^#{6}\\s+(.+)$/gm, ''<h6>$1</h6>'')\n    .replace(/^#{5}\\s+(.+)$/gm, ''<h5>$1</h5>'')\n    .replace(/^#{4}\\s+(.+)$/gm, ''<h4>$1</h4>'')\n    .replace(/^###\\s+(.+)$/gm, ''<h3>$1</h3>'')\n    .replace(/^##\\s+(.+)$/gm, ''<h2>$1</h2>'')\n    .replace(/^#\\s+(.+)$/gm, ''<h1>$1</h1>'')\n    .replace(/\\*\\*(.+?)\\*\\*/g, ''<strong>$1</strong>'')\n    .replace(/\\*(.+?)\\*/g, ''<em>$1</em>'')\n    .replace(/^-\\s+(.+)$/gm, ''<li>$1</li>'')\n    .replace(/(<li>.*<\\/li>)/gs, ''<ul>$1</ul>'')\n    .replace(/\\[(.+?)\\]\\((.+?)\\)/g, ''<a href=\"$2\" target=\"_blank\">$1</a>'')\n    .replace(/\\n\\n/g, ''</p><p>'')\n    .replace(/^(?!<[hup])(.+)$/gm, ''$1'');\n}\nconst body = mdToHtml(md);\nconst html = `<!DOCTYPE html><html><head><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1a1a1a}h1,h2,h3,h4,h5,h6{margin-top:1.5em}code{background:#f4f4f4;padding:.2em .4em;border-radius:3px;font-size:.9em}pre{background:#f4f4f4;padding:1em;border-radius:5px;overflow:auto}pre code{background:none;padding:0}a{color:#0070f3}ul{padding-left:1.5em}</style></head><body><p>${body}</p></body></html>`;\nreturn { contentType: ''text/html'', content: html };"},"type":"function","function":{"name":"MarkdownPreview","description":"Render Markdown text as a styled HTML preview. Use when the user wants to see formatted documentation, notes, or any Markdown content.","parameters":{"type":"object","properties":{"markdown":{"type":"string","description":"Markdown text to render"}},"required":["markdown"]}}}]',
  true,
  null
),

(
  'Color Palette Generator',
  'color-palette',
  'Generate a 5-colour palette as HTML swatches from a theme description.',
  'media',
  '{"color","palette","design","ui"}',
  '[{"clientDefinition":{"id":"color-palette-001","name":"ColorPalette","description":"Generates a 5-colour palette as swatches from a theme description.","arguments":[{"name":"theme","type":"string","description":"Theme description, e.g. sunset, ocean, forest, neon"}],"body":"const theme = (args.theme || ''default'').toLowerCase();\n// Deterministic palette generator from theme string\nfunction strToSeed(s) { let h = 0; for (const c of s) h = Math.imul(31, h) + c.charCodeAt(0) | 0; return Math.abs(h); }\nfunction hslToHex(h, s, l) {\n  s /= 100; l /= 100;\n  const a = s * Math.min(l, 1 - l);\n  const f = n => { const k = (n + h / 30) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))); return Math.round(255 * c).toString(16).padStart(2, ''0''); };\n  return `#${f(0)}${f(8)}${f(4)}`;\n}\nconst seed = strToSeed(theme);\nconst baseHue = seed % 360;\nconst colors = [\n  hslToHex(baseHue, 80, 40),\n  hslToHex((baseHue + 30) % 360, 70, 55),\n  hslToHex((baseHue + 60) % 360, 60, 65),\n  hslToHex((baseHue + 180) % 360, 50, 45),\n  hslToHex((baseHue + 210) % 360, 40, 70),\n];\nconst swatches = colors.map(c => `<div style=\"display:flex;align-items:center;gap:12px;margin:8px 0\"><div style=\"width:60px;height:60px;border-radius:8px;background:${c};box-shadow:0 2px 4px rgba(0,0,0,.2)\"></div><div><code style=\"font-size:1.1em\">${c}</code></div></div>`).join('''');\nconst html = `<!DOCTYPE html><html><head><style>body{font-family:system-ui,sans-serif;padding:1.5rem;background:#fafafa}h2{margin:0 0 1rem;font-size:1rem;color:#555}</style></head><body><h2>Palette for &ldquo;${theme}&rdquo;</h2>${swatches}</body></html>`;\nreturn { contentType: ''text/html'', content: html };"},"type":"function","function":{"name":"ColorPalette","description":"Generate a harmonious 5-colour palette as visual swatches from a theme or mood description.","parameters":{"type":"object","properties":{"theme":{"type":"string","description":"Theme or mood description, e.g. \"ocean\", \"sunset\", \"corporate blue\""}},"required":["theme"]}}}]',
  true,
  null
),

(
  'JSON Formatter',
  'json-formatter',
  'Pretty-print and validate JSON input with syntax highlighting.',
  'developer',
  '{"json","format","validate","developer"}',
  '[{"clientDefinition":{"id":"json-formatter-001","name":"JSONFormatter","description":"Pretty-prints and validates JSON input.","arguments":[{"name":"json","type":"string","description":"JSON string to format"}],"body":"let parsed, formatted, isValid = true, errorMsg = '''';\ntry {\n  parsed = JSON.parse(args.json);\n  formatted = JSON.stringify(parsed, null, 2);\n} catch (e) {\n  isValid = false;\n  errorMsg = e.message;\n  formatted = args.json;\n}\nfunction esc(s) { return s.replace(/&/g,''&amp;'').replace(/</g,''&lt;'').replace(/>/g,''&gt;''); }\nfunction highlight(s) {\n  return esc(s).replace(\n    /(\"(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\\"])*\"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)/g,\n    match => {\n      let cls = ''number'';\n      if (/^\"|/.test(match)) cls = /:$/.test(match) ? ''key'' : ''string'';\n      else if (/true|false/.test(match)) cls = ''boolean'';\n      else if (/null/.test(match)) cls = ''null'';\n      return `<span class=\"${cls}\">${match}</span>`;\n    }\n  );\n}\nconst html = `<!DOCTYPE html><html><head><style>body{margin:0;font-family:monospace;font-size:13px;background:#1e1e1e;color:#d4d4d4}pre{padding:1rem;margin:0;overflow:auto;height:100vh;box-sizing:border-box}.key{color:#9cdcfe}.string{color:#ce9178}.number{color:#b5cea8}.boolean{color:#569cd6}.null{color:#569cd6}.error{background:#5a1a1a;color:#f88;padding:.5rem 1rem;font-size:12px}</style></head><body>${isValid?'''':`<div class=\"error\">Invalid JSON: ${esc(errorMsg)}</div>`}<pre>${highlight(formatted)}</pre></body></html>`;\nreturn { contentType: ''text/html'', content: html };"},"type":"function","function":{"name":"JSONFormatter","description":"Pretty-print and syntax-highlight JSON. Use when the user wants to format, view, or validate a JSON string.","parameters":{"type":"object","properties":{"json":{"type":"string","description":"JSON string to format and validate"}},"required":["json"]}}}]',
  true,
  null
),

(
  'Regex Tester',
  'regex-tester',
  'Test a regular expression against input text and highlight all matches.',
  'developer',
  '{"regex","regexp","pattern","test"}',
  '[{"clientDefinition":{"id":"regex-tester-001","name":"RegexTester","description":"Tests a regular expression against input text and highlights matches.","arguments":[{"name":"pattern","type":"string","description":"Regular expression pattern (without delimiters)"},{"name":"flags","type":"string","description":"Regex flags, e.g. gi"},{"name":"text","type":"string","description":"Input text to test against"}],"body":"const pat = args.pattern || '''';\nconst flags = (args.flags || ''g'').includes(''g'') ? args.flags || ''g'' : (args.flags || '''') + ''g'';\nconst text = args.text || '''';\nfunction esc(s) { return s.replace(/&/g,''&amp;'').replace(/</g,''&lt;'').replace(/>/g,''&gt;''); }\nlet highlighted, matchCount = 0, error = '''';\ntry {\n  const re = new RegExp(pat, flags);\n  const matches = [...text.matchAll(re)];\n  matchCount = matches.length;\n  highlighted = esc(text).replace(new RegExp(esc(pat), flags), m => `<mark>${esc(m)}</mark>`);\n} catch (e) {\n  error = e.message;\n  highlighted = esc(text);\n}\nconst html = `<!DOCTYPE html><html><head><style>body{font-family:system-ui,sans-serif;padding:1rem;color:#1a1a1a}.meta{font-size:12px;color:#666;margin-bottom:.5rem}.pattern{font-family:monospace;background:#f4f4f4;padding:.2em .4em;border-radius:3px}.output{font-family:monospace;font-size:14px;white-space:pre-wrap;word-break:break-all;line-height:1.6;background:#fafafa;padding:1rem;border-radius:5px;border:1px solid #e0e0e0}mark{background:#ffe066;border-radius:2px}.error{color:#c00;font-size:13px;margin-bottom:.5rem}</style></head><body><div class=\"meta\">${error?`<div class=\"error\">Error: ${esc(error)}</div>`:''}<span class=\"pattern\">/${esc(pat)}/${esc(flags)}</span> — <strong>${matchCount}</strong> match${matchCount===1?'''':''es''}</div><div class=\"output\">${highlighted}</div></body></html>`;\nreturn { contentType: ''text/html'', content: html };"},"type":"function","function":{"name":"RegexTester","description":"Test a regular expression against input text and highlight all matches. Use when the user wants to validate, debug, or demonstrate a regex pattern.","parameters":{"type":"object","properties":{"pattern":{"type":"string","description":"Regex pattern without delimiters"},"flags":{"type":"string","description":"Regex flags e.g. \"gi\", default \"g\""},"text":{"type":"string","description":"Text to test the pattern against"}},"required":["pattern","text"]}}}]',
  true,
  null
),

(
  'Unit Converter',
  'unit-converter',
  'Convert between common units: length, weight, temperature, volume, and speed.',
  'utility',
  '{"units","convert","measurement","calculator"}',
  '[{"clientDefinition":{"id":"unit-converter-001","name":"UnitConverter","description":"Converts a value between common units.","arguments":[{"name":"value","type":"number","description":"Numeric value to convert"},{"name":"from","type":"string","description":"Source unit, e.g. km, lb, celsius"},{"name":"to","type":"string","description":"Target unit, e.g. miles, kg, fahrenheit"}],"body":"const conversions = {\n  // length (base: meter)\n  m:1, meter:1, meters:1, km:1000, kilometer:1000, kilometers:1000,\n  cm:0.01, centimeter:0.01, centimeters:0.01, mm:0.001,\n  mile:1609.344, miles:1609.344, ft:0.3048, foot:0.3048, feet:0.3048,\n  inch:0.0254, inches:0.0254, yard:0.9144, yards:0.9144,\n  // weight (base: kg)\n  kg:1, kilogram:1, kilograms:1, g:0.001, gram:0.001, grams:0.001,\n  lb:0.453592, lbs:0.453592, pound:0.453592, pounds:0.453592,\n  oz:0.0283495, ounce:0.0283495, ounces:0.0283495,\n  // volume (base: liter)\n  l:1, liter:1, liters:1, ml:0.001, milliliter:0.001, milliliters:0.001,\n  gallon:3.78541, gallons:3.78541, quart:0.946353, quarts:0.946353,\n  pint:0.473176, pints:0.473176, cup:0.24, cups:0.24, floz:0.0295735,\n  // speed (base: m/s)\n  mps:1, kph:0.277778, mph:0.44704, knot:0.514444, knots:0.514444,\n};\nconst from = (args.from || '''').toLowerCase().trim();\nconst to = (args.to || '''').toLowerCase().trim();\nconst value = Number(args.value);\n// Temperature special case\nfunction convertTemp(v, f, t) {\n  let celsius;\n  if (f===''celsius''||f===''c'') celsius=v;\n  else if (f===''fahrenheit''||f===''f'') celsius=(v-32)*5/9;\n  else if (f===''kelvin''||f===''k'') celsius=v-273.15;\n  else return null;\n  if (t===''celsius''||t===''c'') return celsius;\n  if (t===''fahrenheit''||t===''f'') return celsius*9/5+32;\n  if (t===''kelvin''||t===''k'') return celsius+273.15;\n  return null;\n}\nconst tempUnits = [''c'',''f'',''k'',''celsius'',''fahrenheit'',''kelvin''];\nlet result;\nif (tempUnits.includes(from) || tempUnits.includes(to)) {\n  result = convertTemp(value, from, to);\n  if (result === null) return { error: `Cannot convert ${from} to ${to}` };\n} else {\n  const fFactor = conversions[from];\n  const tFactor = conversions[to];\n  if (!fFactor) return { error: `Unknown unit: ${args.from}` };\n  if (!tFactor) return { error: `Unknown unit: ${args.to}` };\n  result = (value * fFactor) / tFactor;\n}\nreturn { value: args.value, from: args.from, to: args.to, result: +result.toPrecision(8) };"},"type":"function","function":{"name":"UnitConverter","description":"Convert a value between units of length, weight, temperature, volume, or speed.","parameters":{"type":"object","properties":{"value":{"type":"number","description":"Value to convert"},"from":{"type":"string","description":"Source unit e.g. km, lb, celsius, mph"},"to":{"type":"string","description":"Target unit e.g. miles, kg, fahrenheit, kph"}},"required":["value","from","to"]}}}]',
  true,
  null
),

(
  'Mermaid Diagram',
  'mermaid-diagram',
  'Render a Mermaid.js diagram (flowchart, sequence, Gantt, etc.) in an iframe using the CDN build.',
  'developer',
  '{"mermaid","diagram","flowchart","uml","developer"}',
  '[{"clientDefinition":{"id":"mermaid-diagram-001","name":"MermaidDiagram","description":"Renders a Mermaid.js diagram in an iframe.","arguments":[{"name":"diagram","type":"string","description":"Mermaid diagram definition, e.g. graph TD; A-->B"}],"body":"const diagram = args.diagram || ''graph TD\\n  A --> B'';\nfunction esc(s) { return s.replace(/&/g,''&amp;'').replace(/</g,''&lt;'').replace(/>/g,''&gt;'').replace(/\"/g,''&quot;''); }\nconst html = `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fafafa;font-family:system-ui,sans-serif}.mermaid{max-width:100%;padding:1rem}</style></head><body><pre class=\"mermaid\">${esc(diagram)}</pre><script type=\"module\">import mermaid from ''https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs''; mermaid.initialize({startOnLoad:true,theme:''default''});<\\/script></body></html>`;\nreturn { contentType: ''text/html'', content: html };"},"type":"function","function":{"name":"MermaidDiagram","description":"Render a Mermaid.js diagram. Use for flowcharts, sequence diagrams, Gantt charts, class diagrams, ER diagrams, or any diagram the user wants to visualise.","parameters":{"type":"object","properties":{"diagram":{"type":"string","description":"Mermaid diagram definition, e.g. \"graph TD; A-->B; B-->C\""}},"required":["diagram"]}}}]',
  true,
  null
),

(
  'CSV Table Viewer',
  'csv-table',
  'Render CSV input as a sortable HTML table.',
  'data',
  '{"csv","table","data","spreadsheet"}',
  '[{"clientDefinition":{"id":"csv-table-001","name":"CSVTable","description":"Renders CSV text as an interactive sortable HTML table.","arguments":[{"name":"csv","type":"string","description":"CSV text to display"}],"body":"const csv = args.csv || '''';\nfunction parseCSV(text) {\n  return text.trim().split(''\\n'').map(line => {\n    const cols = []; let cur = '''', inQ = false;\n    for (let i = 0; i < line.length; i++) {\n      const ch = line[i];\n      if (ch === ''\"'' && !inQ) { inQ = true; continue; }\n      if (ch === ''\"'' && inQ && line[i+1] === ''\"'') { cur += ''\"''; i++; continue; }\n      if (ch === ''\"'' && inQ) { inQ = false; continue; }\n      if (ch === '','' && !inQ) { cols.push(cur); cur = ''''; continue; }\n      cur += ch;\n    }\n    cols.push(cur);\n    return cols;\n  });\n}\nfunction esc(s) { return String(s).replace(/&/g,''&amp;'').replace(/</g,''&lt;'').replace(/>/g,''&gt;''); }\nconst rows = parseCSV(csv);\nif (!rows.length) return { contentType: ''text/html'', content: ''<p>No data</p>'' };\nconst [headers, ...data] = rows;\nconst thead = `<tr>${headers.map(h=>`<th onclick=\"sortBy(this)\" style=\"cursor:pointer\">${esc(h)} <span class=arr>▲</span></th>`).join('''')}</tr>`;\nconst tbody = data.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('''')}</tr>`).join('''');\nconst html = `<!DOCTYPE html><html><head><style>body{font-family:system-ui,sans-serif;padding:1rem;margin:0}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}th{background:#f0f0f0;user-select:none}tr:nth-child(even){background:#fafafa}tr:hover{background:#f0f7ff}.arr{font-size:10px;opacity:.6}</style></head><body><table><thead>${thead}</thead><tbody id=tb>${tbody}</tbody></table><script>let lastTh=null,asc=true;function sortBy(th){const idx=[...th.parentElement.children].indexOf(th);if(lastTh===th){asc=!asc}else{asc=true;if(lastTh)lastTh.querySelector(''.arr'').textContent=''▲''}lastTh=th;th.querySelector(''.arr'').textContent=asc?''▲'':''▼'';const tb=document.getElementById(''tb'');const rows=[...tb.rows];rows.sort((a,b)=>{const av=a.cells[idx]?.textContent||'''';const bv=b.cells[idx]?.textContent||'''';const an=parseFloat(av),bn=parseFloat(bv);return isNaN(an)||isNaN(bn)?av.localeCompare(bv)*(asc?1:-1):(an-bn)*(asc?1:-1)});rows.forEach(r=>tb.appendChild(r));}<\\/script></body></html>`;\nreturn { contentType: ''text/html'', content: html };"},"type":"function","function":{"name":"CSVTable","description":"Render CSV data as a sortable HTML table. Use when the user provides CSV data and wants to view or explore it.","parameters":{"type":"object","properties":{"csv":{"type":"string","description":"CSV text (first row is treated as headers)"}},"required":["csv"]}}}]',
  true,
  null
),

(
  'World Clock',
  'world-clock',
  'Show the current time in multiple timezones side by side.',
  'utility',
  '{"clock","timezone","time","world"}',
  '[{"clientDefinition":{"id":"world-clock-001","name":"WorldClock","description":"Shows current time in multiple timezones side by side.","arguments":[{"name":"timezones","type":"string","description":"Comma-separated IANA timezone names, e.g. America/New_York,Europe/London,Asia/Tokyo"}],"body":"const zones = (args.timezones || ''America/New_York,Europe/London,Asia/Tokyo,Australia/Sydney'').split('','').map(z=>z.trim()).filter(Boolean);\nfunction esc(s){return String(s).replace(/&/g,''&amp;'').replace(/</g,''&lt;'').replace(/>/g,''&gt;'');}\nfunction clockCard(tz) {\n  const now = new Date();\n  const time = now.toLocaleTimeString(''en-US'',{timeZone:tz,hour:''2-digit'',minute:''2-digit'',second:''2-digit'',hour12:true});\n  const date = now.toLocaleDateString(''en-US'',{timeZone:tz,weekday:''short'',month:''short'',day:''numeric''});\n  const city = tz.split(''/'').pop().replace(/_/g,'' '');\n  return `<div class=card><div class=city>${esc(city)}</div><div class=tz>${esc(tz)}</div><div class=time id=\"t-${esc(tz.replace(/\\//g,''-''))}\">--:--:--</div><div class=date id=\"d-${esc(tz.replace(/\\//g,''-''))}\">${esc(date)}</div></div>`;\n}\nconst cards = zones.map(clockCard).join('''');\nconst tzJson = JSON.stringify(zones);\nconst html = `<!DOCTYPE html><html><head><style>body{margin:0;font-family:system-ui,sans-serif;background:#0f172a;color:#fff;display:flex;flex-wrap:wrap;gap:1rem;padding:1rem;box-sizing:border-box}.card{background:#1e293b;border-radius:12px;padding:1.25rem 1.5rem;min-width:160px;flex:1}.city{font-size:1.2rem;font-weight:600}.tz{font-size:11px;color:#64748b;margin:.2rem 0 .5rem}.time{font-size:2rem;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.5px}.date{font-size:12px;color:#94a3b8;margin-top:.25rem}</style></head><body>${cards}<script>const zones=${tzJson};function tick(){zones.forEach(tz=>{const now=new Date();const id=tz.replace(/\\//g,''-'');const tel=document.getElementById(''t-''+id);const del=document.getElementById(''d-''+id);if(tel)tel.textContent=now.toLocaleTimeString(''en-US'',{timeZone:tz,hour:''2-digit'',minute:''2-digit'',second:''2-digit'',hour12:true});if(del)del.textContent=now.toLocaleDateString(''en-US'',{timeZone:tz,weekday:''short'',month:''short'',day:''numeric''});})}tick();setInterval(tick,1000);<\\/script></body></html>`;\nreturn { contentType: ''text/html'', content: html };"},"type":"function","function":{"name":"WorldClock","description":"Display the current time in multiple timezones side by side, updating every second. Use for time zone comparisons or scheduling across regions.","parameters":{"type":"object","properties":{"timezones":{"type":"string","description":"Comma-separated IANA timezone names, e.g. \"America/New_York,Europe/London,Asia/Tokyo\""}},"required":["timezones"]}}}]',
  true,
  null
),

(
  'Image from URL',
  'image-from-url',
  'Display an image from a URL in a resizable preview iframe.',
  'media',
  '{"image","preview","url","media"}',
  '[{"clientDefinition":{"id":"image-from-url-001","name":"ImageFromURL","description":"Renders an image from a URL in a resizable preview.","arguments":[{"name":"url","type":"string","description":"Image URL to display"},{"name":"alt","type":"string","description":"Alt text for the image"}],"body":"const url = args.url || '''';\nconst alt = args.alt || ''Image'';\nfunction esc(s){return String(s).replace(/&/g,''&amp;'').replace(/</g,''&lt;'').replace(/>/g,''&gt;'').replace(/\"/g,''&quot;'');}\nconst html = `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#1a1a1a;padding:1rem;box-sizing:border-box}img{max-width:100%;max-height:90vh;object-fit:contain;border-radius:6px;box-shadow:0 4px 24px rgba(0,0,0,.5)}.url{color:#888;font-family:monospace;font-size:11px;margin-top:.75rem;word-break:break-all;max-width:600px;text-align:center}</style></head><body><img src=\"${esc(url)}\" alt=\"${esc(alt)}\" /><div class=url>${esc(url)}</div></body></html>`;\nreturn { contentType: ''text/html'', content: html };"},"type":"function","function":{"name":"ImageFromURL","description":"Display an image from a URL in a full preview. Use when the user provides an image URL and wants to see it rendered.","parameters":{"type":"object","properties":{"url":{"type":"string","description":"Direct URL to the image"},"alt":{"type":"string","description":"Descriptive alt text"}},"required":["url"]}}}]',
  true,
  null
),

(
  'Base64 Codec',
  'base64-codec',
  'Encode or decode text to/from Base64.',
  'developer',
  '{"base64","encode","decode","codec"}',
  '[{"clientDefinition":{"id":"base64-codec-001","name":"Base64Codec","description":"Encodes or decodes text using Base64.","arguments":[{"name":"input","type":"string","description":"Text or Base64 string to process"},{"name":"mode","type":"string","description":"encode or decode (default: encode)"}],"body":"const input = args.input || '''';\nconst mode = (args.mode || ''encode'').toLowerCase();\nlet output, error = '''';\ntry {\n  if (mode === ''decode'') {\n    output = atob(input.replace(/\\s/g, ''''));\n  } else {\n    output = btoa(unescape(encodeURIComponent(input)));\n  }\n} catch (e) {\n  error = e.message;\n  output = '''';\n}\nreturn { mode, input, output: output || '''', ...(error ? { error } : {}) };"},"type":"function","function":{"name":"Base64Codec","description":"Encode text to Base64 or decode Base64 back to text.","parameters":{"type":"object","properties":{"input":{"type":"string","description":"Text to encode, or Base64 string to decode"},"mode":{"type":"string","enum":["encode","decode"],"description":"\"encode\" converts text to Base64; \"decode\" converts Base64 to text. Default: encode"}},"required":["input"]}}}]',
  true,
  null
),

(
  'Word Counter',
  'word-counter',
  'Count words, characters, sentences, and estimated reading time for any text.',
  'productivity',
  '{"words","count","text","writing","productivity"}',
  '[{"clientDefinition":{"id":"word-counter-001","name":"WordCounter","description":"Counts words, characters, sentences, and reading time.","arguments":[{"name":"text","type":"string","description":"Text to analyse"}],"body":"const text = args.text || '''';\nconst words = text.trim() ? text.trim().split(/\\s+/).length : 0;\nconst chars = text.length;\nconst charsNoSpace = text.replace(/\\s/g, '''').length;\nconst sentences = text.trim() ? (text.match(/[.!?]+/g) || []).length || 1 : 0;\nconst paragraphs = text.trim() ? text.split(/\\n\\s*\\n/).filter(p=>p.trim()).length || 1 : 0;\nconst readingTimeSec = Math.ceil(words / (238 / 60)); // 238 wpm average\nconst minutes = Math.floor(readingTimeSec / 60);\nconst seconds = readingTimeSec % 60;\nconst readingTime = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;\nreturn { words, characters: chars, charactersNoSpaces: charsNoSpace, sentences, paragraphs, readingTime };"},"type":"function","function":{"name":"WordCounter","description":"Count words, characters, sentences, paragraphs, and estimated reading time for a piece of text.","parameters":{"type":"object","properties":{"text":{"type":"string","description":"Text to analyse"}},"required":["text"]}}}]',
  true,
  null
)

on conflict (slug) do nothing;

commit;
