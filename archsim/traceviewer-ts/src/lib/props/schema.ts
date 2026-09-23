import type { PropDef, PropScalar, PropSchema, PropTuple, PropType } from './spec';

type Json = Record<string, unknown>;

/**
 * Generated JSON Schema is **draft-07**, not 2020-12.
 *
 * `createAjvValidator` imports the draft-07 `Ajv` class and constructs it with ajv 8's default
 * `strict: true`, which throws on an unknown keyword at compile time -- i.e. when the property
 * panel mounts, not when this file type-checks. So a tuple is `items: [...]` plus
 * `additionalItems: false`, never `prefixItems`. `strictTuples` also warns unless `minItems`
 * and `maxItems` are both present, which is why they are always emitted.
 */
function scalarSchema(t: PropScalar): Json {
  switch (t.type) {
    case 'string':
      return { type: 'string', ...(t.minLength !== undefined ? { minLength: t.minLength } : {}) };
    case 'integer':
      return {
        type: 'integer',
        ...(t.minimum !== undefined ? { minimum: t.minimum } : {}),
        ...(t.maximum !== undefined ? { maximum: t.maximum } : {}),
      };
    case 'boolean':
      return { type: 'boolean' };
    case 'enum':
      return { type: 'string', enum: [...t.values] };
  }
}

function tupleSchema(t: PropTuple): Json {
  const n = t.items.length;
  return {
    type: 'array',
    items: t.items.map(scalarSchema),
    additionalItems: false,
    minItems: n,
    maxItems: n,
  };
}

function typeSchema(t: PropType): Json {
  if (t.type === 'tuple') return tupleSchema(t);
  if (t.type === 'list') {
    return {
      type: 'array',
      items: t.item.type === 'tuple' ? tupleSchema(t.item) : scalarSchema(t.item),
      ...(t.minItems !== undefined ? { minItems: t.minItems } : {}),
    };
  }
  return scalarSchema(t);
}

const schemaCache = new Map<string, Json>();

/**
 * `jsonSchemaFor`, memoized by kind.
 *
 * A kind's schema is derived from a declaration that never changes at runtime, and the enum
 * value renderer asks for it once per value node on every tree render. Building it fresh each
 * time is a lot of garbage for an object that is a constant in all but name.
 */
export function schemaFor(ps: PropSchema): Json {
  let j = schemaCache.get(ps.kind);
  if (j === undefined) {
    j = jsonSchemaFor(ps);
    schemaCache.set(ps.kind, j);
  }
  return j;
}

/**
 * `additionalProperties: false` plus a `required` entry for every key is what makes the schema
 * reject an inserted or deleted tree node. That is most of "don't let the user break the
 * document", and it comes from the declaration rather than from hand-written guards.
 */
export function jsonSchemaFor(ps: PropSchema): Json {
  const properties: Json = {};
  for (const d of ps.props) {
    properties[d.key] = {
      ...typeSchema(d.type),
      description: d.doc,
      // A real draft-07 annotation, so ajv accepts it and the schema documents itself.
      ...(d.mode === 'edit' ? {} : { readOnly: true }),
    };
  }
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    title: ps.title,
    description: ps.doc,
    properties,
    required: ps.props.map((d) => d.key),
    additionalProperties: false,
  };
}

/* ------------------------------------------------------------------ human-readable types ---- */

function describeScalar(t: PropScalar): string {
  switch (t.type) {
    case 'string':
      return t.minLength !== undefined && t.minLength > 0 ? 'non-empty text' : 'text';
    case 'integer': {
      if (t.minimum !== undefined && t.maximum !== undefined) {
        return `integer ${t.minimum}–${t.maximum}`;
      }
      if (t.minimum !== undefined) return `integer ≥ ${t.minimum}`;
      if (t.maximum !== undefined) return `integer ≤ ${t.maximum}`;
      return 'integer, unbounded';
    }
    case 'boolean':
      return 'true or false';
    case 'enum':
      return `one of ${t.values.join(', ')}`;
  }
}

/** The one-line type summary the panel footer shows beside a property's title. */
export function describeType(t: PropType): string {
  if (t.type === 'tuple') {
    const inner = t.items.map(describeScalar);
    const uniform = inner.every((d) => d === inner[0]);
    const kinds = uniform ? (inner[0] ?? '') : inner.join(', ');
    return `[${t.labels.join(', ')}] — ${uniform ? `${t.items.length} × ` : ''}${kinds}`;
  }
  if (t.type === 'list') {
    const inner = t.item.type === 'tuple' ? describeType(t.item) : describeScalar(t.item);
    return `list of ${inner}`;
  }
  return describeScalar(t);
}

export function describeProp(d: PropDef): string {
  const t = describeType(d.type);
  return d.mode === 'edit' ? t : `${t} · read-only`;
}
