/**
 * Single import that pulls in every shape, tool and panel for their registration side effects.
 * Adding a kind, a tool or a panel means adding a line here and nothing else.
 */
import './scene/shapes/rect';
import './scene/shapes/conn';
// Listed in toolbar order for readability only: the order drawn comes from each tool's
// own `group` and `order`, so moving a line here moves nothing on screen.
import './tools/select-tool';
import './tools/marquee-tool';
import './tools/rect-tool';
import './tools/connect-tool';
import './panels/diagram-panel';
import './panels/properties-panel';
import './panels/trace-panel';
