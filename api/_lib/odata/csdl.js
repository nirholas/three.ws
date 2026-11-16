// CSDL XML ($metadata) and the JSON service document for the usage feed,
// generated from the entity model so the documents and the query engine can
// never disagree. Capabilities annotations tell clients (Power Query reads
// them) which query options fold: filter functions, sorting, counting, top and
// skip, and that nothing expands, inserts, updates or deletes.

import { ENTITY_SETS, NAMESPACE, CONTAINER } from './usage-model.js';

const CAPABILITIES_URI = 'https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Capabilities.V1.xml';
const CORE_URI = 'https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.xml';

export const FILTER_FUNCTIONS = ['contains', 'startswith', 'endswith', 'tolower', 'toupper', 'trim', 'length', 'year', 'month', 'day', 'hour', 'minute', 'date'];

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const description = (text, indent) => `${indent}<Annotation Term="Core.Description" String="${xml(text)}"/>`;

function property(name, p) {
	const attrs = [`Name="${name}"`, `Type="${p.type}"`];
	if (p.nullable === false) attrs.push('Nullable="false"');
	if (p.precision != null) attrs.push(`Precision="${p.precision}"`);
	if (p.scale != null) attrs.push(`Scale="${p.scale}"`);
	return `        <Property ${attrs.join(' ')}>\n${description(p.description, '          ')}\n        </Property>`;
}

function entityType(set) {
	const props = Object.entries(set.props).map(([name, p]) => property(name, p)).join('\n');
	return `      <EntityType Name="${set.name}">
        <Key><PropertyRef Name="Id"/></Key>
${props}
${description(set.description, '        ')}
      </EntityType>`;
}

function boolRecord(term, fields) {
	const values = Object.entries(fields).map(([k, v]) => `<PropertyValue Property="${k}" Bool="${v}"/>`).join('');
	return `          <Annotation Term="Capabilities.${term}"><Record>${values}</Record></Annotation>`;
}

function entitySet(set) {
	return `        <EntitySet Name="${set.name}" EntityType="${NAMESPACE}.${set.name}">
${description(set.description, '          ')}
          <Annotation Term="Capabilities.TopSupported" Bool="true"/>
          <Annotation Term="Capabilities.SkipSupported" Bool="true"/>
${boolRecord('CountRestrictions', { Countable: true })}
${boolRecord('FilterRestrictions', { Filterable: true })}
${boolRecord('SortRestrictions', { Sortable: true })}
${boolRecord('ExpandRestrictions', { Expandable: false })}
${boolRecord('SearchRestrictions', { Searchable: false })}
${boolRecord('InsertRestrictions', { Insertable: false })}
${boolRecord('UpdateRestrictions', { Updatable: false })}
${boolRecord('DeleteRestrictions', { Deletable: false })}
        </EntitySet>`;
}

/** The $metadata document (OData v4.0 CSDL XML). */
export function metadataXml() {
	const fns = FILTER_FUNCTIONS.map((f) => `<String>${f}</String>`).join('');
	return `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:Reference Uri="${CORE_URI}">
    <edmx:Include Namespace="Org.OData.Core.V1" Alias="Core"/>
  </edmx:Reference>
  <edmx:Reference Uri="${CAPABILITIES_URI}">
    <edmx:Include Namespace="Org.OData.Capabilities.V1" Alias="Capabilities"/>
  </edmx:Reference>
  <edmx:DataServices>
    <Schema Namespace="${NAMESPACE}" xmlns="http://docs.oasis-open.org/odata/ns/edm">
${ENTITY_SETS.map(entityType).join('\n')}
      <EntityContainer Name="${CONTAINER}">
${ENTITY_SETS.map(entitySet).join('\n')}
        <Annotation Term="Capabilities.FilterFunctions"><Collection>${fns}</Collection></Annotation>
        <Annotation Term="Capabilities.ConformanceLevel" EnumMember="Capabilities.ConformanceLevelType/Minimal"/>
        <Annotation Term="Core.Description" String="three.ws usage feed: read-only usage, LLM, Forge and billing rows for Power BI, Excel and any OData v4 client."/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
`;
}

/** The service document (OData v4 JSON format, section 5). */
export function serviceDocument(base) {
	return {
		'@odata.context': `${base}$metadata`,
		value: ENTITY_SETS.map((s) => ({ name: s.name, kind: 'EntitySet', url: s.name })),
	};
}
