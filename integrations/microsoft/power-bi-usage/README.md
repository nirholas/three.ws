# three.ws usage in Power BI and Excel

Typed Power Query scripts and a starter report for the three.ws OData usage feed. Point Power BI Desktop, the Power BI Service or Excel at the feed, refresh on a schedule, and report on MCP tool calls, LLM tokens and cost, Forge generations and metered billing for yourself or your whole team.

The feed itself, its entity sets, query options, limits and security are documented in [docs/usage-odata.md](../../../docs/usage-odata.md).

## What is here

| Path | What it is |
|---|---|
| [`queries/FeedUrl.pq`](queries/FeedUrl.pq) | Power Query parameter holding the feed root, `https://three.ws/api/odata/v1/` |
| [`queries/UsageDaily.pq`](queries/UsageDaily.pq) | Usage events per UTC day, person and event kind |
| [`queries/McpToolCalls.pq`](queries/McpToolCalls.pq) | One row per MCP tool call |
| [`queries/LlmUsage.pq`](queries/LlmUsage.pq) | LLM calls, tokens and cost per day, person, provider and model |
| [`queries/Generations.pq`](queries/Generations.pq) | One row per Forge 3D generation job |
| [`queries/Billing.pq`](queries/Billing.pq) | Microsoft Marketplace metering per hour and metered three.ws charges per day |
| [`report-spec.md`](report-spec.md) | The starter report: model, relationships, DAX measures, four pages |

Every query reads the feed with `OData.Feed(FeedUrl, null, [Implementation = "2.0"])`, keeps exactly the columns the feed serves and sets each column's type (`Table.TransformColumnTypes`), so the model stays stable when the feed adds a column later.

The `.pq` files are generated from the feed's entity model by [`scripts/build-power-bi-usage-queries.mjs`](../../../scripts/build-power-bi-usage-queries.mjs). Do not edit them by hand. `tests/power-bi-usage-queries.test.js` fails when they drift from the model, and every file parses with Microsoft's [Power Query parser](https://github.com/microsoft/powerquery-parser).

## 1. Create a feed key

On three.ws open **Settings, Connect to Power BI or Excel** (`/dashboard/settings#usage-feed`).

1. Name the key after the report or workbook that will use it.
2. Under **Data it can read**, pick **My own usage** or one of the teams you own. A team key reads the owner's rows and the rows of every active person in the team.
3. Choose **Create key** and copy it. It is shown once.

Keys are read-only. Revoke one from the same panel; refreshes that use it fail from the next request.

## 2. Power BI Desktop

Quickest path, no scripts:

1. **Home, Get data, More, OData feed.**
2. Paste `https://three.ws/api/odata/v1/` and choose **OK**.
3. Choose **Basic**. User name: anything (for example `powerbi`). Password: the feed key.
4. Tick the tables you want and choose **Load**.

Typed path, with these scripts (recommended for a report you will share):

1. **Home, Transform data** to open the Power Query editor.
2. **New Source, Blank Query**, then **Advanced Editor**. Paste [`queries/FeedUrl.pq`](queries/FeedUrl.pq) and rename the query `FeedUrl`. It becomes a parameter.
3. For each table: **New Source, Blank Query, Advanced Editor**, paste the `.pq` file and rename the query to the file name (`UsageDaily`, `McpToolCalls`, `LlmUsage`, `Generations`, `Billing`).
4. When asked for credentials, choose **Basic** at the `https://three.ws/api/odata/v1/` level and enter the key as the password.
5. **Close and Apply**, then build the report from [`report-spec.md`](report-spec.md).

Filters you add in Power Query (a date range, one team, one model) are sent to the feed as `$filter`, so only the matching rows travel.

## 3. Power BI Service scheduled refresh

1. **Publish** the report from Desktop to a workspace.
2. In the workspace open the semantic model's **Settings, Data source credentials, Edit credentials**.
3. Authentication method **Basic**, the same user name and the feed key as the password. Privacy level **Organizational**.
4. Turn on **Scheduled refresh** and pick the times. No gateway is needed: the feed is a public HTTPS endpoint.

When you revoke the key, refresh fails with an authentication error; create a new key and paste it into the credentials.

## 4. Excel

1. **Data, Get Data, From Other Sources, From OData Feed.**
2. Paste `https://three.ws/api/odata/v1/`, choose **Basic**, any user name, the key as the password.
3. Pick the tables and **Load**. **Data, Refresh All** pulls fresh rows; **Query Properties, Refresh every N minutes** keeps a workbook current while it is open.

The typed scripts work in Excel's Power Query editor exactly as in Desktop.

## Report template (.pbit)

A `.pbit` is a binary that only Power BI Desktop writes, so it is exported by the owner rather than generated here. To produce `three-ws-usage.pbit`:

1. In Power BI Desktop, build the report from the typed path above and [`report-spec.md`](report-spec.md).
2. **File, Export, Power BI template**, description "three.ws usage feed starter report", and save it as `integrations/microsoft/power-bi-usage/three-ws-usage.pbit`.

Opening the template prompts for `FeedUrl` (default `https://three.ws/api/odata/v1/`) and then for the Basic credentials.

## Limits

600 requests per minute per key, pages of up to 1000 rows (Power BI follows `@odata.nextLink` on its own), and up to 10 active keys per account. Details in [docs/usage-odata.md](../../../docs/usage-odata.md#limits).

Microsoft, Power BI, Power Query and Excel are trademarks of the Microsoft group of companies.
