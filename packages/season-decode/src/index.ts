import fieldJson from '../field.json' with { type: 'json' };
import type { FieldDefinition } from '@ftc-sim/field';

export function getDecodeField(): FieldDefinition {
  return fieldJson as FieldDefinition;
}

export * from './field-layout.js';
