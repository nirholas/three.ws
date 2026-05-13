// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Repository — Agent Deployments (CI/CD)
// =============================================================================

import { eq, and, desc } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { agentDeployments } from '../schema'

export type AgentDeployment = typeof agentDeployments.$inferSelect
export type NewAgentDeployment = typeof agentDeployments.$inferInsert

export type DeploymentEnvironment = 'development' | 'staging' | 'production'
export type DeploymentStatus = 'pending' | 'deploying' | 'active' | 'failed' | 'rolled_back'

export class AgentDeploymentRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewAgentDeployment): Promise<AgentDeployment> {
    const [deployment] = await this.db.insert(agentDeployments).values(data).returning()
    return deployment
  }

  async findById(id: string): Promise<AgentDeployment | undefined> {
    return this.db.query.agentDeployments.findFirst({
      where: eq(agentDeployments.id, id),
    })
  }

  async findByAgentId(agentId: string): Promise<AgentDeployment[]> {
    return this.db.query.agentDeployments.findMany({
      where: eq(agentDeployments.agentId, agentId),
      orderBy: [desc(agentDeployments.deployedAt)],
    })
  }

  async findActiveByEnvironment(agentId: string, environment: DeploymentEnvironment): Promise<AgentDeployment | undefined> {
    return this.db.query.agentDeployments.findFirst({
      where: and(
        eq(agentDeployments.agentId, agentId),
        eq(agentDeployments.environment, environment),
        eq(agentDeployments.status, 'active'),
      ),
    })
  }

  async updateStatus(id: string, status: DeploymentStatus): Promise<AgentDeployment | undefined> {
    const [deployment] = await this.db
      .update(agentDeployments)
      .set({ status })
      .where(eq(agentDeployments.id, id))
      .returning()
    return deployment
  }

  async rollback(id: string, reason: string): Promise<AgentDeployment | undefined> {
    const [deployment] = await this.db
      .update(agentDeployments)
      .set({
        status: 'rolled_back' as string,
        rolledBackAt: new Date(),
        rollbackReason: reason,
      })
      .where(eq(agentDeployments.id, id))
      .returning()
    return deployment
  }

  async updateMetrics(id: string, metrics: unknown): Promise<AgentDeployment | undefined> {
    const [deployment] = await this.db
      .update(agentDeployments)
      .set({ metrics })
      .where(eq(agentDeployments.id, id))
      .returning()
    return deployment
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(agentDeployments).where(eq(agentDeployments.id, id))
  }
}


