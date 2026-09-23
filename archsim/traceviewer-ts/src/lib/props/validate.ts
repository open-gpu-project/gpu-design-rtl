import {
  createAjvValidator,
  ValidationSeverity,
  type JSONSchema,
  type ValidationError,
  type Validator,
} from 'svelte-jsoneditor';
import { schemaFor } from './schema';
import type { PropSchema } from './spec';

/** ajv compiles the schema, so this must happen once per kind and not once per keystroke. */
const compiled = new Map<string, Validator>();

function ajvFor(ps: PropSchema): Validator {
  let v = compiled.get(ps.kind);
  if (v === undefined) {
    v = createAjvValidator({ schema: schemaFor(ps) as JSONSchema });
    compiled.set(ps.kind, v);
  }
  return v;
}

/**
 * ajv first, then the constraints JSON Schema cannot express.
 *
 * `others` is a callback rather than a snapshot so the returned validator keeps a stable
 * identity for the panel's lifetime while still seeing the current scene -- handing the editor
 * a fresh `validator` on every scene change would make it re-validate constantly.
 *
 * Uniqueness is checked here *and* again in the `name` writer, on purpose: this pass produces
 * the live red annotation, and the writer is what actually refuses the commit. The editor
 * delivers invalid documents to `onChange` regardless of what a validator says.
 */
export function makeValidator(ps: PropSchema, others: () => Iterable<string>): Validator {
  const ajv = ajvFor(ps);
  return (json: unknown): ValidationError[] => {
    const errors = [...ajv(json)];
    const name = (json as Record<string, unknown> | null)?.['name'];
    if (typeof name === 'string') {
      for (const taken of others()) {
        if (taken !== name) continue;
        errors.push({
          path: ['name'],
          message: `Another block is already named “${name}”.`,
          severity: ValidationSeverity.error,
        });
        break;
      }
    }
    return errors;
  };
}
