-- ── plugins — JSON manifest plugin marketplace ───────────────────────────────
-- Each row is a community-published plugin manifest.
-- Plugins are keyed by (identifier, author_id) so the same identifier can be
-- published by different authors without conflict.

create table if not exists plugins (
    id            uuid        primary key default gen_random_uuid(),
    author_id     uuid        references users(id) on delete set null,
    identifier    text        not null,
    manifest_url  text,
    manifest_json jsonb       not null,
    name          text        not null,
    description   text        not null default '',
    category      text        not null default 'general',
    tags          text[]      not null default '{}',
    is_public     boolean     not null default true,
    install_count integer     not null default 0,
    avg_rating    numeric(3,2) not null default 0,
    rating_count  integer     not null default 0,
    deleted_at    timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (identifier, author_id)
);

create index if not exists plugins_category_idx      on plugins(category);
create index if not exists plugins_author_idx        on plugins(author_id);
create index if not exists plugins_popular_idx       on plugins(install_count desc);
create index if not exists plugins_new_idx           on plugins(created_at desc);
create index if not exists plugins_identifier_idx    on plugins(identifier);

do $$ begin
    create trigger plugins_set_updated_at before update on plugins
        for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ── Seed: built-in community plugins ─────────────────────────────────────────

insert into plugins (identifier, name, description, category, tags, manifest_json, is_public) values

('web-search', 'Web Search', 'Search the web for up-to-date information and return top results inline.',
 'utility', '{"search","web","utility"}',
 '{"schema_version":"plugin/1.0","identifier":"web-search","version":"1.0.0","meta":{"title":"Web Search","description":"Search the web for up-to-date information and return top results inline.","tags":["search","web","utility"],"category":"utility"},"api":[{"name":"search_web","description":"Search the web for a query and return relevant results","url":null,"method":"POST","parameters":{"type":"object","properties":{"query":{"type":"string","description":"The search query"},"max_results":{"type":"integer","description":"Maximum number of results to return (default 5)","default":5}},"required":["query"]}}],"system_role":"You can search the web for current information. Use search_web when the user asks about recent events, current data, or anything you may not have up-to-date knowledge about."}',
 true),

('datetime', 'Date & Time', 'Get the current date, time, and timezone in any conversation.',
 'utility', '{"time","date","timezone","utility"}',
 '{"schema_version":"plugin/1.0","identifier":"datetime","version":"1.0.0","meta":{"title":"Date & Time","description":"Get the current date, time, and timezone in any conversation.","tags":["time","date","timezone","utility"],"category":"utility"},"api":[{"name":"get_current_time","description":"Get the current date and time for a given timezone","url":null,"method":"POST","parameters":{"type":"object","properties":{"timezone":{"type":"string","description":"IANA timezone name (e.g. America/New_York). Defaults to UTC.","default":"UTC"}},"required":[]}},{"name":"convert_timezone","description":"Convert a time from one timezone to another","url":null,"method":"POST","parameters":{"type":"object","properties":{"time":{"type":"string","description":"ISO 8601 datetime string"},"from_tz":{"type":"string","description":"Source IANA timezone"},"to_tz":{"type":"string","description":"Target IANA timezone"}},"required":["time","from_tz","to_tz"]}}],"system_role":"You can retrieve the current date and time and convert between timezones. Use get_current_time when the user asks what time or date it is."}',
 true),

('calculator', 'Calculator', 'Perform precise arithmetic calculations and unit conversions.',
 'utility', '{"math","calculator","arithmetic","utility"}',
 '{"schema_version":"plugin/1.0","identifier":"calculator","version":"1.0.0","meta":{"title":"Calculator","description":"Perform precise arithmetic calculations and unit conversions.","tags":["math","calculator","arithmetic","utility"],"category":"utility"},"api":[{"name":"calculate","description":"Evaluate a mathematical expression and return the result","url":null,"method":"POST","parameters":{"type":"object","properties":{"expression":{"type":"string","description":"Mathematical expression to evaluate (e.g. 2 + 2, sqrt(16), sin(pi/2))"}},"required":["expression"]}}],"system_role":"You have access to a calculator. Use calculate for any arithmetic, algebra, or trigonometry the user requests."}',
 true),

('image-gen', 'Image Generator', 'Generate images from text descriptions using AI.',
 'creative', '{"image","ai","creative","generation"}',
 '{"schema_version":"plugin/1.0","identifier":"image-gen","version":"1.0.0","meta":{"title":"Image Generator","description":"Generate images from text descriptions using AI.","tags":["image","ai","creative","generation"],"category":"creative"},"api":[{"name":"generate_image","description":"Generate an image from a text prompt","url":null,"method":"POST","parameters":{"type":"object","properties":{"prompt":{"type":"string","description":"Detailed description of the image to generate"},"style":{"type":"string","description":"Art style (e.g. photorealistic, cartoon, watercolor)","default":"photorealistic"},"size":{"type":"string","description":"Image dimensions","enum":["512x512","1024x1024","1792x1024"],"default":"1024x1024"}},"required":["prompt"]}}],"system_role":"You can generate images from text descriptions. Use generate_image when the user asks you to create, draw, or visualize something."}',
 true),

('weather', 'Weather', 'Get real-time weather conditions and forecasts for any location.',
 'utility', '{"weather","forecast","location","utility"}',
 '{"schema_version":"plugin/1.0","identifier":"weather","version":"1.0.0","meta":{"title":"Weather","description":"Get real-time weather conditions and forecasts for any location.","tags":["weather","forecast","location","utility"],"category":"utility"},"api":[{"name":"get_weather","description":"Get current weather conditions for a location","url":null,"method":"POST","parameters":{"type":"object","properties":{"location":{"type":"string","description":"City name or coordinates (lat,lon)"},"units":{"type":"string","description":"Temperature units","enum":["celsius","fahrenheit"],"default":"celsius"}},"required":["location"]}},{"name":"get_forecast","description":"Get a multi-day weather forecast for a location","url":null,"method":"POST","parameters":{"type":"object","properties":{"location":{"type":"string","description":"City name or coordinates"},"days":{"type":"integer","description":"Number of forecast days (1-7)","default":3},"units":{"type":"string","description":"Temperature units","enum":["celsius","fahrenheit"],"default":"celsius"}},"required":["location"]}}],"system_role":"You can retrieve live weather conditions and forecasts. Use get_weather for current conditions and get_forecast for multi-day outlooks."}',
 true),

('code-runner', 'Code Runner', 'Execute Python, JavaScript, or shell code snippets in a sandbox.',
 'developer', '{"code","python","javascript","developer","sandbox"}',
 '{"schema_version":"plugin/1.0","identifier":"code-runner","version":"1.0.0","meta":{"title":"Code Runner","description":"Execute Python, JavaScript, or shell code snippets in a sandbox.","tags":["code","python","javascript","developer","sandbox"],"category":"developer"},"api":[{"name":"run_code","description":"Execute a code snippet in a sandboxed environment","url":null,"method":"POST","parameters":{"type":"object","properties":{"code":{"type":"string","description":"The code to execute"},"language":{"type":"string","description":"Programming language","enum":["python","javascript","bash"],"default":"python"}},"required":["code"]}}],"system_role":"You can run code in a secure sandbox. Use run_code when the user wants to test code, run calculations, or verify logic."}',
 true),

('tradingview', 'TradingView Charts', 'Embed live candlestick charts for any crypto or stock symbol.',
 'finance', '{"finance","crypto","stocks","charts","tradingview"}',
 '{"schema_version":"plugin/1.0","identifier":"tradingview","version":"1.0.0","meta":{"title":"TradingView Charts","description":"Embed live candlestick charts for any crypto or stock symbol.","tags":["finance","crypto","stocks","charts","tradingview"],"category":"finance"},"api":[{"name":"show_chart","description":"Display a TradingView chart for a symbol","url":null,"method":"POST","parameters":{"type":"object","properties":{"symbol":{"type":"string","description":"Ticker symbol (e.g. BTCUSDT, AAPL, EURUSD)"},"interval":{"type":"string","description":"Chart interval","enum":["1m","5m","15m","1h","4h","1D","1W"],"default":"1D"},"theme":{"type":"string","description":"Chart color theme","enum":["dark","light"],"default":"dark"}},"required":["symbol"]}}],"system_role":"You can show live TradingView charts. Use show_chart when the user asks about price action, charts, or technical analysis for any tradable symbol."}',
 true)

on conflict (identifier, author_id) do nothing;
