/**
 * Severity classifier - re-exports from threat-classifier with rebranded names.
 * The underlying classification logic is unchanged.
 */

export {
  type ThreatLevel as SeverityLevel,
  type EventCategory,
  type ThreatClassification as SeverityClassification,
  THREAT_COLORS as SEVERITY_COLORS,
  THREAT_PRIORITY as SEVERITY_PRIORITY,
  THREAT_LABELS as SEVERITY_LABELS,
  classifyByKeyword,
  classifyWithAI,
  aggregateThreats,
} from './threat-classifier';

// Re-export deprecated names for backward compatibility
export {
  type ThreatLevel,
  type ThreatClassification,
  THREAT_COLORS,
  THREAT_PRIORITY,
  THREAT_LABELS,
} from './threat-classifier';
