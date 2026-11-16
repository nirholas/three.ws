# Starter report: three.ws usage

The report the [typed queries](queries/) are built for. Build it once in Power BI Desktop, then export it as the template described in the [README](README.md#report-template-pbit).

## Model

### Tables

The five feed queries (`UsageDaily`, `McpToolCalls`, `LlmUsage`, `Generations`, `Billing`) plus two built in Power BI:

**Calendar** (calculated table, marked as the date table on `Date`):

```dax
Calendar =
VAR FirstDay = MINX ( { MIN ( UsageDaily[Date] ), MIN ( LlmUsage[Date] ), DATEVALUE ( MIN ( McpToolCalls[Timestamp] ) ), DATEVALUE ( MIN ( Generations[CreatedAt] ) ) }, [Value] )
RETURN
    ADDCOLUMNS (
        CALENDAR ( COALESCE ( FirstDay, TODAY () ), TODAY () ),
        "Month", FORMAT ( [Date], "yyyy-mm" ),
        "Week", WEEKNUM ( [Date], 2 ),
        "Weekday", FORMAT ( [Date], "ddd" )
    )
```

**People** (calculated table, one row per account seen in any table):

```dax
People =
DISTINCT (
    UNION (
        SELECTCOLUMNS ( UsageDaily, "UserId", UsageDaily[UserId], "UserName", UsageDaily[UserName], "UserEmail", UsageDaily[UserEmail], "TeamName", UsageDaily[TeamName] ),
        SELECTCOLUMNS ( LlmUsage, "UserId", LlmUsage[UserId], "UserName", LlmUsage[UserName], "UserEmail", LlmUsage[UserEmail], "TeamName", LlmUsage[TeamName] ),
        SELECTCOLUMNS ( McpToolCalls, "UserId", McpToolCalls[UserId], "UserName", McpToolCalls[UserName], "UserEmail", McpToolCalls[UserEmail], "TeamName", McpToolCalls[TeamName] ),
        SELECTCOLUMNS ( Generations, "UserId", Generations[UserId], "UserName", Generations[UserName], "UserEmail", Generations[UserEmail], "TeamName", Generations[TeamName] ),
        SELECTCOLUMNS ( Billing, "UserId", Billing[UserId], "UserName", Billing[UserName], "UserEmail", Billing[UserEmail], "TeamName", Billing[TeamName] )
    )
)
```

Add a `Person` column for slicers: `Person = COALESCE ( People[UserName], People[UserEmail] )`.

### Date columns for the timestamp tables

In Power Query, add a date column to the three tables keyed by time, so they relate to `Calendar`:

| Table | New column | Formula (Add Column, Custom Column) | Type |
|---|---|---|---|
| McpToolCalls | `Date` | `Date.From(DateTimeZone.SwitchZone([Timestamp], 0))` | date |
| Generations | `Date` | `Date.From(DateTimeZone.SwitchZone([CreatedAt], 0))` | date |
| Billing | `Date` | `Date.From(DateTimeZone.SwitchZone([PeriodStart], 0))` | date |

`SwitchZone(..., 0)` keeps the day in UTC, matching `UsageDaily[Date]` and `LlmUsage[Date]`.

### Relationships

All single-direction, many-to-one:

| From | To |
|---|---|
| `UsageDaily[Date]`, `LlmUsage[Date]`, `McpToolCalls[Date]`, `Generations[Date]`, `Billing[Date]` | `Calendar[Date]` |
| `UsageDaily[UserId]`, `LlmUsage[UserId]`, `McpToolCalls[UserId]`, `Generations[UserId]`, `Billing[UserId]` | `People[UserId]` |

## Measures

Put them in a `Measures` table (Enter data, one empty column, then hide the column).

```dax
Tool calls = COUNTROWS ( McpToolCalls )
Tool error rate = DIVIDE ( CALCULATE ( COUNTROWS ( McpToolCalls ), McpToolCalls[Status] <> "ok" ), [Tool calls] )
Median tool latency (ms) = MEDIAN ( McpToolCalls[DurationMs] )

LLM calls = SUM ( LlmUsage[Calls] )
Input tokens = SUM ( LlmUsage[InputTokens] )
Output tokens = SUM ( LlmUsage[OutputTokens] )
Total tokens = [Input tokens] + [Output tokens]
LLM cost (USD) = SUM ( LlmUsage[CostUsd] )
Cost per 1k tokens (USD) = DIVIDE ( [LLM cost (USD)], [Total tokens] ) * 1000

Generations = COUNTROWS ( Generations )
Generations done = CALCULATE ( [Generations], Generations[Status] = "done" )
Generation success rate = DIVIDE ( [Generations done], CALCULATE ( [Generations], Generations[Status] IN { "done", "failed" } ) )
Accepted rate = DIVIDE ( CALCULATE ( [Generations], Generations[Outcome] = "accepted" ), [Generations done] )
Median generation time (s) = MEDIAN ( Generations[DurationSeconds] )

Metered charges (USD) = SUM ( Billing[AmountUsd] )
Marketplace quantity = CALCULATE ( SUM ( Billing[Quantity] ), Billing[Source] = "microsoft_marketplace" )

Events = SUM ( UsageDaily[Quantity] )
Event errors = SUM ( UsageDaily[ErrorCount] )
Active people = DISTINCTCOUNT ( UsageDaily[UserId] )

LLM cost MTD (USD) = TOTALMTD ( [LLM cost (USD)], Calendar[Date] )
LLM cost prior month (USD) = CALCULATE ( [LLM cost (USD)], DATEADD ( Calendar[Date], -1, MONTH ) )
```

Format the USD measures as currency with two decimals (the columns hold six, so small per-call costs still add up exactly), the rates as percentages, and the counts as whole numbers.

## Pages

Every page carries the same slicers on the left: `Calendar[Date]` (between), `People[TeamName]`, `People[Person]`.

### 1. Overview

- Cards: `Active people`, `Tool calls`, `LLM calls`, `Total tokens`, `LLM cost (USD)`, `Generations`.
- Line chart: `Events` by `Calendar[Date]`, legend `UsageDaily[Metric]`.
- Clustered bar: `LLM cost (USD)` by `People[Person]`, top 10.
- Card with trend: `LLM cost MTD (USD)` against `LLM cost prior month (USD)`.

### 2. MCP tools

- Bar: `Tool calls` by `McpToolCalls[Tool]`, sorted descending.
- Line: `Tool calls` and `Tool error rate` (secondary axis) by `Calendar[Date]`.
- Table: `Tool`, `Tool calls`, `Tool error rate`, `Median tool latency (ms)`, with conditional formatting on the error rate.
- Matrix: rows `People[Person]`, columns `McpToolCalls[Status]`, values `Tool calls`.

### 3. LLM usage and cost

- Stacked column: `Total tokens` by `Calendar[Date]`, legend `LlmUsage[Provider]`.
- Treemap: `LLM cost (USD)` by `LlmUsage[Model]`.
- Table: `Provider`, `Model`, `LLM calls`, `Input tokens`, `Output tokens`, `LLM cost (USD)`, `Cost per 1k tokens (USD)`.
- Decomposition tree: `LLM cost (USD)` explained by `People[TeamName]`, `People[Person]`, `LlmUsage[Model]`.

### 4. Forge generations and billing

- Cards: `Generations`, `Generation success rate`, `Accepted rate`, `Median generation time (s)`.
- Stacked column: `Generations` by `Calendar[Date]`, legend `Generations[Tier]`.
- Bar: `Generations` by `Generations[Backend]`.
- Table: `Billing[Date]`, `Source`, `Dimension`, `Quantity`, `AmountUsd`, `Status`. A note in a text box: "Microsoft Marketplace rows are priced by Microsoft; AmountUsd is empty for them."

## Refresh

Schedule the semantic model to refresh daily (or up to the Service's limit for the workspace's capacity). One full refresh reads every row the key can see; each set arrives in pages of up to 1000 rows, well inside the 600 requests per minute a key may make.
