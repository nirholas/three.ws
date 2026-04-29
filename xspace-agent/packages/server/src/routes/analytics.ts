// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Analytics Routes — Conversation Intelligence API
// =============================================================================

import { Router, type Request, type Response } from 'express'
import {
  AnalyticsRepository,
  runAnalyticsPipeline,
  generateInsights,
  scoreSentiment,
  SessionRepository,
  ConversationDBRepository,
} from 'xspace-agent'
import type { AnalyticsPipelineInput, AnalyticsMessage } from 'xspace-agent'
import { validate } from '../middleware/validation'
import { buildErrorResponse } from '../middleware/error-handler'
import {
  AnalyticsSessionParamsSchema,
  SentimentQuerySchema,
  AggregateQuerySchema,
  TrendsQuerySchema,
  WeeklyReportQuerySchema,
  ExportQuerySchema,
} from '../schemas/analytics'

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createAnalyticsRoutes(): Router {
  const router = Router()
  const analyticsRepo = new AnalyticsRepository()
  const sessionRepo = new SessionRepository()
  const conversationRepo = new ConversationDBRepository()

  // ── GET /analytics/sessions/:id — Full analytics for a session ─────────

  router.get('/analytics/sessions/:id', validate(AnalyticsSessionParamsSchema, 'params'), async (req: Request, res: Response) => {
    try {
      const tenant = req.tenant
      if (!tenant) {
        res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
          requestId: (req as any).id,
        }))
        return
      }

      const analytics = await analyticsRepo.getBySessionId(req.params.id)
      if (!analytics) {
        res.status(404).json(buildErrorResponse('NOT_FOUND', 'Analytics not found for this session', {
          requestId: (req as any).id,
        }))
        return
      }

      if (analytics.orgId !== tenant.orgId) {
        res.status(403).json(buildErrorResponse('FORBIDDEN', 'Access denied', {
          requestId: (req as any).id,
        }))
        return
      }

      res.json(analytics)
    } catch (err) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', 'Failed to fetch analytics', {
        requestId: (req as any).id,
      }))
    }
  })

  // ── GET /analytics/sessions/:id/sentiment — Sentiment timeseries ──────

  router.get('/analytics/sessions/:id/sentiment', validate(AnalyticsSessionParamsSchema, 'params'), validate(SentimentQuerySchema, 'query'), async (req: Request, res: Response) => {
    try {
      const tenant = req.tenant
      if (!tenant) {
        res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
          requestId: (req as any).id,
        }))
        return
      }

      const speaker = (req as any).validated?.speaker as string | undefined
      const timeseries = await analyticsRepo.getSentimentTimeseries(req.params.id, { speaker })

      res.json({ sessionId: req.params.id, points: timeseries })
    } catch (err) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', 'Failed to fetch sentiment data', {
        requestId: (req as any).id,
      }))
    }
  })

  // ── GET /analytics/sessions/:id/topics — Topic breakdown ──────────────

  router.get('/analytics/sessions/:id/topics', validate(AnalyticsSessionParamsSchema, 'params'), async (req: Request, res: Response) => {
    try {
      const tenant = req.tenant
      if (!tenant) {
        res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
          requestId: (req as any).id,
        }))
        return
      }

      const analytics = await analyticsRepo.getBySessionId(req.params.id)
      if (!analytics) {
        res.status(404).json(buildErrorResponse('NOT_FOUND', 'Analytics not found', {
          requestId: (req as any).id,
        }))
        return
      }

      res.json({
        sessionId: req.params.id,
        primaryTopic: analytics.primaryTopic,
        topics: analytics.topics,
      })
    } catch (err) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', 'Failed to fetch topic data', {
        requestId: (req as any).id,
      }))
    }
  })

  // ── GET /analytics/sessions/:id/speakers — Speaker analytics ──────────

  router.get('/analytics/sessions/:id/speakers', validate(AnalyticsSessionParamsSchema, 'params'), async (req: Request, res: Response) => {
    try {
      const tenant = req.tenant
      if (!tenant) {
        res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
          requestId: (req as any).id,
        }))
        return
      }

      const analytics = await analyticsRepo.getBySessionId(req.params.id)
      if (!analytics) {
        res.status(404).json(buildErrorResponse('NOT_FOUND', 'Analytics not found', {
          requestId: (req as any).id,
        }))
        return
      }

      res.json({
        sessionId: req.params.id,
        speakers: analytics.speakers,
        participantCount: analytics.participantCount,
      })
    } catch (err) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', 'Failed to fetch speaker data', {
        requestId: (req as any).id,
      }))
    }
  })

  // ── GET /analytics/sessions/:id/insights — AI-generated insights ──────

  router.get('/analytics/sessions/:id/insights', validate(AnalyticsSessionParamsSchema, 'params'), async (req: Request, res: Response) => {
    try {
      const tenant = req.tenant
      if (!tenant) {
        res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
          requestId: (req as any).id,
        }))
        return
      }

      const analytics = await analyticsRepo.getBySessionId(req.params.id)
      if (!analytics) {
        res.status(404).json(buildErrorResponse('NOT_FOUND', 'Analytics not found', {
          requestId: (req as any).id,
        }))
        return
      }

      res.json({
        sessionId: req.params.id,
        summary: analytics.summary,
        keyDecisions: analytics.keyDecisions,
        actionItems: analytics.actionItems,
        recommendations: analytics.recommendations,
        highlights: analytics.highlights,
        riskFlags: analytics.riskFlags,
      })
    } catch (err) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', 'Failed to fetch insights', {
        requestId: (req as any).id,
      }))
    }
  })

  // ── GET /analytics/aggregate — Aggregate analytics across sessions ────

  router.get('/analytics/aggregate', validate(AggregateQuerySchema, 'query'), async (req: Request, res: Response) => {
    try {
      const tenant = req.tenant
      if (!tenant) {
        res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
          requestId: (req as any).id,
        }))
        return
      }

      const period = (req as any).validated?.period as string | undefined
      let since: Date | undefined
      if (period) {
        const days = parseInt(period.replace('d', ''), 10) || 30
        since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      }

      const stats = await analyticsRepo.getAggregateStats(tenant.orgId, { since })

      res.json(stats)
    } catch (err) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', 'Failed to fetch aggregate analytics', {
        requestId: (req as any).id,
      }))
    }
  })

  // ── GET /analytics/trends — Trend analysis ────────────────────────────

  router.get('/analytics/trends', validate(TrendsQuerySchema, 'query'), async (req: Request, res: Response) => {
    try {
      const tenant = req.tenant
      if (!tenant) {
        res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
          requestId: (req as any).id,
        }))
        return
      }

      const days = (req as any).validated?.days ?? 30
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

      const { rows } = await analyticsRepo.getByOrgId(tenant.orgId, { since, limit: 1000 })

      // Compute daily averages
      const dailyMap = new Map<string, { sentimentSum: number; count: number; durationSum: number }>()
      for (const row of rows) {
        const day = row.processedAt ? new Date(row.processedAt).toISOString().slice(0, 10) : 'unknown'
        const existing = dailyMap.get(day) || { sentimentSum: 0, count: 0, durationSum: 0 }
        existing.sentimentSum += row.sentimentAvg ?? 0
        existing.count++
        existing.durationSum += row.durationSeconds ?? 0
        dailyMap.set(day, existing)
      }

      const trends = [...dailyMap.entries()]
        .map(([date, data]) => ({
          date,
          avgSentiment: data.count > 0 ? data.sentimentSum / data.count : 0,
          sessionCount: data.count,
          avgDurationSeconds: data.count > 0 ? data.durationSum / data.count : 0,
        }))
        .sort((a, b) => a.date.localeCompare(b.date))

      res.json({ period: `${days}d`, trends })
    } catch (err) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', 'Failed to fetch trends', {
        requestId: (req as any).id,
      }))
    }
  })

  // ── POST /analytics/sessions/:id/reprocess — Re-run analytics ─────────

  router.post('/analytics/sessions/:id/reprocess', validate(AnalyticsSessionParamsSchema, 'params'), async (req: Request, res: Response) => {
    try {
      const tenant = req.tenant
      if (!tenant) {
        res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
          requestId: (req as any).id,
        }))
        return
      }

      const sessionId = req.params.id

      // Fetch session and conversation data
      const session = await sessionRepo.findById(sessionId)
      if (!session) {
        res.status(404).json(buildErrorResponse('NOT_FOUND', 'Session not found', {
          requestId: (req as any).id,
        }))
        return
      }
      if (session.orgId !== tenant.orgId) {
        res.status(403).json(buildErrorResponse('FORBIDDEN', 'Access denied', {
          requestId: (req as any).id,
        }))
        return
      }

      const conversations = await conversationRepo.findBySessionId(sessionId)
      if (!conversations || conversations.length === 0) {
        res.status(404).json(buildErrorResponse('NOT_FOUND', 'No conversation data found for session', {
          requestId: (req as any).id,
        }))
        return
      }

      // Build pipeline input from conversation messages
      const allMessages: AnalyticsMessage[] = []
      for (const conv of conversations) {
        const messages = (conv.messages ?? []) as Array<{
          speaker?: string
          text?: string
          content?: string
          timestamp?: number
          role?: string
        }>
        for (const msg of messages) {
          allMessages.push({
            speaker: msg.speaker || msg.role || 'unknown',
            text: msg.text || msg.content || '',
            timestamp: msg.timestamp || Date.now(),
            isFinal: true,
          })
        }
      }

      const startedAt = session.startedAt ? new Date(session.startedAt).getTime() : Date.now()
      const endedAt = session.endedAt ? new Date(session.endedAt).getTime() : Date.now()

      const input: AnalyticsPipelineInput = {
        sessionId,
        orgId: tenant.orgId,
        messages: allMessages,
        startedAt,
        endedAt,
      }

      // Run pipeline
      const result = runAnalyticsPipeline(input)
      const insights = generateInsights(result, allMessages)

      // Store results
      await analyticsRepo.upsertSessionAnalytics({
        sessionId,
        orgId: tenant.orgId,
        durationSeconds: result.metrics.durationSeconds,
        activeSpeakingSeconds: result.metrics.activeSpeakingSeconds,
        silenceSeconds: result.metrics.silenceSeconds,
        participantCount: result.metrics.participantCount,
        totalTurns: result.metrics.totalTurns,
        avgTurnLengthSeconds: result.metrics.avgTurnLengthSeconds,
        sentimentAvg: result.sentimentAvg,
        sentimentMin: result.sentimentMin,
        sentimentMax: result.sentimentMax,
        sentimentTrend: result.sentimentTrend,
        topics: result.topics,
        primaryTopic: result.primaryTopic,
        speakers: result.speakers,
        summary: insights.summary,
        keyDecisions: insights.keyDecisions,
        actionItems: insights.actionItems,
        recommendations: insights.recommendations,
        highlights: insights.highlights,
        riskFlags: insights.riskFlags,
      })

      // Store sentiment timeseries
      await analyticsRepo.deleteSentimentBySessionId(sessionId)
      if (result.sentimentPoints.length > 0) {
        await analyticsRepo.insertSentimentBatch(
          result.sentimentPoints.map(p => ({
            sessionId,
            timestamp: new Date(p.timestamp),
            speaker: p.speaker,
            sentiment: p.sentiment,
            topic: p.topic,
          }))
        )
      }

      res.json({
        status: 'reprocessed',
        sessionId,
        summary: insights.summary,
        topicCount: result.topics.length,
        speakerCount: result.speakers.length,
        highlightCount: insights.highlights.length,
      })
    } catch (err) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', 'Failed to reprocess analytics', {
        requestId: (req as any).id,
      }))
    }
  })

  // ── GET /analytics/sessions/:id/transcript — Annotated transcript ─────

  router.get('/analytics/sessions/:id/transcript', validate(AnalyticsSessionParamsSchema, 'params'), async (req: Request, res: Response) => {
    try {
      const tenant = req.tenant
      if (!tenant) {
        res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
          requestId: (req as any).id,
        }))
        return
      }

      const sessionId = req.params.id
      const conversations = await conversationRepo.findBySessionId(sessionId)
      if (!conversations || conversations.length === 0) {
        res.status(404).json(buildErrorResponse('NOT_FOUND', 'No transcript data found', {
          requestId: (req as any).id,
        }))
        return
      }

      const analytics = await analyticsRepo.getBySessionId(sessionId)

      // Build annotated transcript
      const annotatedMessages: Array<{
        speaker: string
        text: string
        timestamp: number
        sentiment: { value: number; label: string }
        topic?: string
      }> = []

      const topicsByTime = (analytics?.topics as Array<{ topic: string }>) ?? []
      const primaryTopic = analytics?.primaryTopic ?? 'general'

      for (const conv of conversations) {
        const messages = (conv.messages ?? []) as Array<{
          speaker?: string
          text?: string
          content?: string
          timestamp?: number
          role?: string
        }>
        for (const msg of messages) {
          const text = msg.text || msg.content || ''
          if (!text) continue
          const sentimentScore = scoreSentiment(text)
          annotatedMessages.push({
            speaker: msg.speaker || msg.role || 'unknown',
            text,
            timestamp: msg.timestamp || 0,
            sentiment: sentimentScore,
            topic: primaryTopic,
          })
        }
      }

      res.json({
        sessionId,
        messageCount: annotatedMessages.length,
        transcript: annotatedMessages,
      })
    } catch (err) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', 'Failed to fetch transcript', {
        requestId: (req as any).id,
      }))
    }
  })

  // ── GET /analytics/reports/weekly — Weekly intelligence report ─────────

  router.get('/analytics/reports/weekly', validate(WeeklyReportQuerySchema, 'query'), async (req: Request, res: Response) => {
    try {
      const tenant = req.tenant
      if (!tenant) {
        res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
          requestId: (req as any).id,
        }))
        return
      }

      const weeksBack = (req as any).validated?.weeksBack ?? 0
      const now = new Date()
      const weekEnd = new Date(now.getTime() - weeksBack * 7 * 24 * 60 * 60 * 1000)
      const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000)

      const { rows, total } = await analyticsRepo.getByOrgId(tenant.orgId, {
        since: weekStart,
        until: weekEnd,
        limit: 10000,
      })

      if (rows.length === 0) {
        res.json({
          period: { start: weekStart.toISOString(), end: weekEnd.toISOString() },
          totalSessions: 0,
          summary: 'No sessions recorded during this period.',
          metrics: null,
          topTopics: [],
          sentimentOverview: null,
          topSpeakers: [],
          recommendations: [],
        })
        return
      }

      // Aggregate metrics
      const totalSessions = rows.length
      const avgSentiment = rows.reduce((s, r) => s + (r.sentimentAvg ?? 0), 0) / totalSessions
      const avgDuration = rows.reduce((s, r) => s + (r.durationSeconds ?? 0), 0) / totalSessions
      const avgParticipants = rows.reduce((s, r) => s + (r.participantCount ?? 0), 0) / totalSessions
      const totalTurns = rows.reduce((s, r) => s + (r.totalTurns ?? 0), 0)

      // Aggregate topics across all sessions
      const topicCounts = new Map<string, number>()
      for (const row of rows) {
        const topics = (row.topics ?? []) as Array<{ topic: string; messageCount?: number }>
        for (const t of topics) {
          topicCounts.set(t.topic, (topicCounts.get(t.topic) || 0) + (t.messageCount || 1))
        }
      }
      const topTopics = [...topicCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([topic, count]) => ({ topic, sessionMentions: count }))

      // Sentiment distribution
      let positiveCount = 0
      let negativeCount = 0
      let neutralCount = 0
      for (const row of rows) {
        const avg = row.sentimentAvg ?? 0
        if (avg > 0.2) positiveCount++
        else if (avg < -0.2) negativeCount++
        else neutralCount++
      }

      // Aggregate top speakers
      const speakerEngagement = new Map<string, { totalTalkPct: number; sessions: number; totalEngagement: number }>()
      for (const row of rows) {
        const speakers = (row.speakers ?? []) as Array<{ name: string; talkTimePct: number; engagementScore: number }>
        for (const s of speakers) {
          const existing = speakerEngagement.get(s.name) || { totalTalkPct: 0, sessions: 0, totalEngagement: 0 }
          existing.totalTalkPct += s.talkTimePct
          existing.sessions++
          existing.totalEngagement += s.engagementScore
          speakerEngagement.set(s.name, existing)
        }
      }
      const topSpeakers = [...speakerEngagement.entries()]
        .map(([name, data]) => ({
          name,
          avgTalkTimePct: data.totalTalkPct / data.sessions,
          avgEngagementScore: data.totalEngagement / data.sessions,
          sessionCount: data.sessions,
        }))
        .sort((a, b) => b.sessionCount - a.sessionCount)
        .slice(0, 10)

      // Collect all recommendations
      const allRecommendations = new Set<string>()
      for (const row of rows) {
        const recs = (row.recommendations ?? []) as string[]
        for (const r of recs) allRecommendations.add(r)
      }

      // Risk summary
      const riskCounts = new Map<string, number>()
      for (const row of rows) {
        const flags = (row.riskFlags ?? []) as Array<{ type: string }>
        for (const f of flags) {
          riskCounts.set(f.type, (riskCounts.get(f.type) || 0) + 1)
        }
      }

      const sentimentLabel =
        avgSentiment > 0.3 ? 'positive' :
        avgSentiment < -0.3 ? 'negative' : 'neutral'

      const summary = [
        `${totalSessions} session(s) recorded this week.`,
        `Average duration: ${Math.round(avgDuration / 60)} minutes with ${Math.round(avgParticipants)} participant(s).`,
        `Overall sentiment was ${sentimentLabel}.`,
        topTopics.length > 0 ? `Top topics: ${topTopics.slice(0, 3).map(t => t.topic).join(', ')}.` : '',
      ].filter(Boolean).join(' ')

      res.json({
        period: { start: weekStart.toISOString(), end: weekEnd.toISOString() },
        totalSessions,
        summary,
        metrics: {
          avgSentiment: Math.round(avgSentiment * 100) / 100,
          avgDurationMinutes: Math.round(avgDuration / 60),
          avgParticipants: Math.round(avgParticipants * 10) / 10,
          totalTurns,
        },
        sentimentOverview: {
          positive: positiveCount,
          neutral: neutralCount,
          negative: negativeCount,
        },
        topTopics,
        topSpeakers,
        risks: [...riskCounts.entries()].map(([type, count]) => ({ type, count })),
        recommendations: [...allRecommendations].slice(0, 10),
      })
    } catch (err) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', 'Failed to generate weekly report', {
        requestId: (req as any).id,
      }))
    }
  })

  // ── GET /analytics/reports/export — CSV/JSON export ────────────────────

  router.get('/analytics/reports/export', validate(ExportQuerySchema, 'query'), async (req: Request, res: Response) => {
    try {
      const tenant = req.tenant
      if (!tenant) {
        res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
          requestId: (req as any).id,
        }))
        return
      }

      const format = (req as any).validated?.format ?? 'csv'
      const period = (req as any).validated?.period ?? '30d'
      const days = parseInt(period.replace('d', ''), 10) || 30
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

      const { rows } = await analyticsRepo.getByOrgId(tenant.orgId, { since, limit: 10000 })

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Content-Disposition', `attachment; filename="analytics-export-${period}.json"`)
        res.json({ exportedAt: new Date().toISOString(), period, sessions: rows })
        return
      }

      // CSV export
      const headers = [
        'session_id', 'duration_seconds', 'active_speaking_seconds', 'silence_seconds',
        'participant_count', 'total_turns', 'avg_turn_length_seconds',
        'sentiment_avg', 'sentiment_min', 'sentiment_max', 'sentiment_trend',
        'primary_topic', 'summary', 'processed_at',
      ]

      const csvRows = [headers.join(',')]
      for (const row of rows) {
        const values = [
          row.sessionId ?? '',
          row.durationSeconds ?? '',
          row.activeSpeakingSeconds ?? '',
          row.silenceSeconds ?? '',
          row.participantCount ?? '',
          row.totalTurns ?? '',
          row.avgTurnLengthSeconds ?? '',
          row.sentimentAvg ?? '',
          row.sentimentMin ?? '',
          row.sentimentMax ?? '',
          row.sentimentTrend ?? '',
          `"${(row.primaryTopic ?? '').replace(/"/g, '""')}"`,
          `"${(row.summary ?? '').replace(/"/g, '""')}"`,
          row.processedAt ? new Date(row.processedAt).toISOString() : '',
        ]
        csvRows.push(values.join(','))
      }

      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="analytics-export-${period}.csv"`)
      res.send(csvRows.join('\n'))
    } catch (err) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', 'Failed to export analytics', {
        requestId: (req as any).id,
      }))
    }
  })

  return router
}


