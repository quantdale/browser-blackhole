/**
 * Barrel export for the Atlas UI component kit (pure DOM layer).
 * Consumers: src/app/atlasApp.ts (product shell integration).
 */

export {
  createButtonRow,
  createCollapsibleSection,
  createModeSwitch,
  createReadoutList,
  createSelectRow,
  createSliderRow,
  createTimelineTransport,
  createToggleRow,
  nextDomId
} from './components.js';
export type {
  ButtonAction,
  CollapsibleSectionHandle,
  CollapsibleSectionOptions,
  ModeSwitchHandle,
  ModeSwitchOption,
  ModeSwitchOptions,
  ReadoutEntry,
  ReadoutListHandle,
  SelectOption,
  SelectRowHandle,
  SelectRowOptions,
  SliderRowHandle,
  SliderRowOptions,
  TimelineTransportHandle,
  TimelineTransportOptions,
  ToggleRowHandle,
  ToggleRowOptions
} from './components.js';
export { clamp01, decimalsFromStep, finiteClamp, finiteOrNull, formatSliderValue } from './util.js';
