import {
  descriptionProp,
  kindProp,
  labelModeProp,
  labelProp,
  nameProp,
  positionProp,
  sizeProp,
  subtitleProp,
  zIndexProp,
} from '../../props/common';
import { propSchema, type PropDef, type PropSchema } from '../../props/spec';
import type { RectShape } from '../shape';
import { interfacesProp } from './interfaces.props';

/**
 * The rectangle's properties.
 *
 * Read this as the definition of what a block *is*. Adding a property is one entry here: the
 * JSON Schema, the ajv validation, the tree editor's rows, the footer documentation and the
 * saved file all follow from it, and nothing else needs to change.
 *
 * Where in this array is not one of the things that follows from it: `propSchema` sorts on the
 * way out, so put a new property wherever it reads best next to its neighbours.
 *
 * Since iteration 6 the nine keys a block shares with the other box kinds come from
 * `props/common.ts`. A property unique to blocks is still declared here, inline, in full.
 */
const props: readonly PropDef<RectShape>[] = [
  kindProp('rect'),
  nameProp('block'),
  labelProp('block'),
  positionProp(),
  sizeProp('block'),
  interfacesProp('block', 'the top border'),
  subtitleProp('block'),
  labelModeProp('block'),
  descriptionProp('what this hardware block does'),
  zIndexProp(),
];

export const rectProps: PropSchema<RectShape> = propSchema({
  kind: 'rect',
  title: 'Block',
  doc: 'A rectangular hardware entity in the architecture diagram.',
  props,
});
