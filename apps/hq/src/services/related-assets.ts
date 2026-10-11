import type { ClusteredEvent, RelatedAsset, AssetType, RelatedAssetContext } from '@/types';
import { haversineKm } from '@/utils/geo';
import {
  FOCUS_AREAS,
  RISK_REGIONS,
  TRACKED_FACILITIES,
  UNDERSEA_CABLES,
  ENERGY_FACILITIES,
  AI_DATA_CENTERS,
  PIPELINES,
} from '@/config';

const MAX_DISTANCE_KM = 600;
const MAX_ASSETS_PER_TYPE = 3;

const ASSET_KEYWORDS: Record<AssetType, string[]> = {
  pipeline: ['pipeline', 'oil pipeline', 'gas pipeline', 'fuel pipeline', 'pipeline leak', 'pipeline spill'],
  cable: ['cable', 'undersea cable', 'subsea cable', 'fiber cable', 'fiber optic', 'internet cable'],
  datacenter: ['datacenter', 'data center', 'server farm', 'colocation', 'hyperscale'],
  facility: ['facility', 'base', 'data center', 'node', 'hub', 'compound'],
  energy: ['energy', 'reactor', 'power plant', 'nuclear', 'enrichment'],
};

const ASSET_LABELS: Record<AssetType, string> = {
  pipeline: 'Pipeline',
  cable: 'Cable',
  datacenter: 'Datacenter',
  facility: 'Facility',
  energy: 'Energy',
};

interface AssetOrigin {
  lat: number;
  lon: number;
  label: string;
}

function toTitleLower(titles: string[]): string[] {
  return titles.map(title => title.toLowerCase());
}

function detectAssetTypes(titles: string[]): AssetType[] {
  const normalized = toTitleLower(titles);
  const types = Object.entries(ASSET_KEYWORDS)
    .filter(([, keywords]) =>
      normalized.some(title => keywords.some(keyword => title.includes(keyword)))
    )
    .map(([type]) => type as AssetType);
  return types;
}

function countKeywordMatches(titles: string[], keywords: string[]): number {
  const normalized = toTitleLower(titles);
  return keywords.reduce((count, keyword) => {
    return count + normalized.filter(title => title.includes(keyword)).length;
  }, 0);
}

function inferOrigin(titles: string[]): AssetOrigin | null {
  const hotspotCandidates = FOCUS_AREAS.map((hotspot) => ({
    label: hotspot.name,
    lat: hotspot.lat,
    lon: hotspot.lon,
    score: countKeywordMatches(titles, hotspot.keywords),
  })).filter(candidate => candidate.score > 0);

  const zoneCandidates = RISK_REGIONS.map((zone) => ({
    label: zone.name,
    lat: zone.center[1],
    lon: zone.center[0],
    score: countKeywordMatches(titles, zone.keywords ?? []),
  })).filter(candidate => candidate.score > 0);

  const allCandidates = [...hotspotCandidates, ...zoneCandidates];
  if (allCandidates.length === 0) return null;

  return allCandidates.sort((a, b) => b.score - a.score)[0] ?? null;
}

function midpoint(points: [number, number][]): { lat: number; lon: number } | null {
  if (points.length === 0) return null;
  const mid = points[Math.floor(points.length / 2)] as [number, number];
  return { lon: mid[0], lat: mid[1] };
}

function buildAssetIndex(type: AssetType): Array<{ id: string; name: string; lat: number; lon: number } | null> {
  switch (type) {
    case 'pipeline':
      return PIPELINES.map(pipeline => {
        const mid = midpoint(pipeline.points);
        if (!mid) return null;
        return { id: pipeline.id, name: pipeline.name, lat: mid.lat, lon: mid.lon };
      });
    case 'cable':
      return UNDERSEA_CABLES.map(cable => {
        const mid = midpoint(cable.points);
        if (!mid) return null;
        return { id: cable.id, name: cable.name, lat: mid.lat, lon: mid.lon };
      });
    case 'datacenter':
      return AI_DATA_CENTERS.map(dc => ({ id: dc.id, name: dc.name, lat: dc.lat, lon: dc.lon }));
    case 'facility':
      return TRACKED_FACILITIES.map(base => ({ id: base.id, name: base.name, lat: base.lat, lon: base.lon }));
    case 'energy':
      return ENERGY_FACILITIES.map(site => ({ id: site.id, name: site.name, lat: site.lat, lon: site.lon }));
    default:
      return [];
  }
}

function findNearbyAssets(origin: AssetOrigin, types: AssetType[]): RelatedAsset[] {
  const results: RelatedAsset[] = [];

  types.forEach((type) => {
    const candidates = buildAssetIndex(type)
      .filter((asset): asset is { id: string; name: string; lat: number; lon: number } => !!asset)
      .map((asset) => ({
        ...asset,
        distanceKm: haversineKm(origin.lat, origin.lon, asset.lat, asset.lon),
      }))
      .filter(asset => asset.distanceKm <= MAX_DISTANCE_KM)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, MAX_ASSETS_PER_TYPE);

    candidates.forEach(candidate => {
      results.push({
        id: candidate.id,
        name: candidate.name,
        type,
        distanceKm: candidate.distanceKm,
      });
    });
  });

  return results.sort((a, b) => a.distanceKm - b.distanceKm);
}

export function getClusterAssetContext(cluster: ClusteredEvent): RelatedAssetContext | null {
  const titles = cluster.allItems.map(item => item.title);
  const types = detectAssetTypes(titles);
  if (types.length === 0) return null;

  const origin = inferOrigin(titles);
  if (!origin) return null;

  const assets = findNearbyAssets(origin, types);
  return { origin, assets, types };
}

export function getAssetLabel(type: AssetType): string {
  return ASSET_LABELS[type];
}

export function getNearbyInfrastructure(
  lat: number, lon: number, types: AssetType[]
): RelatedAsset[] {
  return findNearbyAssets({ lat, lon, label: 'country-centroid' }, types);
}

export { haversineKm as haversineDistanceKm };

export { MAX_DISTANCE_KM };
