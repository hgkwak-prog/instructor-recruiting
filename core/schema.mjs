/**
 * Minimal JSON Schema validator covering exactly the keyword subset used by
 * schemas/recruitment-result.schema.json: type (string or array of strings),
 * enum, properties, required, additionalProperties:false, items, pattern.
 *
 * Deliberately dependency-free. If the schema grows beyond this subset, add the
 * keyword here rather than silently ignoring it -- unknownKeywords() guards that.
 */

const SUPPORTED = new Set([
  '$schema', 'title', 'description', 'type', 'enum', 'properties', 'required',
  'additionalProperties', 'items', 'pattern'
]);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  return actual === expected;
}

export function unknownKeywords(schema, path = '#') {
  const found = [];
  if (!schema || typeof schema !== 'object') return found;
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) found.push(`${path}.${key}`);
  }
  if (schema.properties) {
    for (const [key, sub] of Object.entries(schema.properties)) {
      found.push(...unknownKeywords(sub, `${path}.properties.${key}`));
    }
  }
  if (schema.items) found.push(...unknownKeywords(schema.items, `${path}.items`));
  return found;
}

export function validate(value, schema, path = '') {
  const errors = [];
  const at = path || '(root)';

  if (schema.enum) {
    if (!schema.enum.includes(value)) {
      errors.push(`${at}: ${JSON.stringify(value)}는 허용값이 아닙니다 (${schema.enum.join(' | ')})`);
    }
    return errors;
  }

  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((one) => matchesType(value, one))) {
      errors.push(`${at}: 타입이 ${expected.join('|')}이어야 하는데 ${typeOf(value)}입니다`);
      return errors;
    }
  }

  if (schema.pattern && typeof value === 'string') {
    if (!new RegExp(schema.pattern).test(value)) {
      errors.push(`${at}: "${value}"가 형식 ${schema.pattern}에 맞지 않습니다`);
    }
  }

  if (typeOf(value) === 'object' && (schema.properties || schema.required)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${at}: 필수 키 "${key}"가 없습니다`);
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties, key)) {
          errors.push(`${at}: 정의되지 않은 키 "${key}"가 있습니다`);
        }
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) {
        errors.push(...validate(value[key], sub, path ? `${path}.${key}` : key));
      }
    }
  }

  if (typeOf(value) === 'array' && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validate(item, schema.items, `${at}[${index}]`));
    });
  }

  return errors;
}

/** Fact keys declared by the schema, so prompts and code cannot drift apart. */
export function factKeys(schema) {
  return Object.keys(schema.properties?.facts?.properties ?? {});
}
