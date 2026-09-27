import {
  descriptionProp,
  kindProp,
  labelModeProp,
  labelProp,
  nameProp,
  parentProp,
  positionProp,
  sizeProp,
  subtitleProp,
  zIndexProp,
} from '../../props/common';
import { propSchema, type PropDef, type PropSchema } from '../../props/spec';
import type { FabricShape } from '../shape';
import { interfacesProp } from './interfaces.props';

/**
 * The fabric's properties.
 *
 * Identical to a block's, plus the interface count -- which is the whole of what makes it a
 * fabric today. The kinds stay separate rather than a block growing a "is a fabric" flag,
 * because the two differ in which borders they offer an interface (`interfaceSides`) and that is
 * a fact about the kind, not a setting.
 */
const props: readonly PropDef<FabricShape>[] = [
  kindProp('fabric'),
  nameProp('fabric'),
  labelProp('fabric'),
  positionProp(),
  sizeProp('fabric'),
  interfacesProp('fabric', 'the top and bottom borders'),
  subtitleProp('fabric'),
  labelModeProp('fabric'),
  descriptionProp('what this fabric routes, and between what'),
  parentProp('fabric'),
  zIndexProp(),
];

export const fabricProps: PropSchema<FabricShape> = propSchema({
  kind: 'fabric',
  title: 'Fabric',
  doc: 'A switch fabric: a box carrying a row of network interfaces on its top and bottom borders.',
  props,
});
