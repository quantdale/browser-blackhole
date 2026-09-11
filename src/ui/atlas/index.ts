/**
 * Barrel export for the Atlas UI component kit (pure DOM layer).
 * Consumers: src/app/atlasApp.ts (product shell integration).
 */

export {
  createButtonRow,
  createCollapsibleSection,
  createGroup,
  createIcon,
  createModeSwitch,
  createPanelHeader,
  createReadoutList,
  createSelectRow,
  createSliderRow,
  createTimelineTransport,
  createToggleRow,
  nextDomId
} from './components.js';
export type {
  AtlasIconName,
  ButtonAction,
  CollapsibleSectionHandle,
  CollapsibleSectionOptions,
  GroupHandle,
  ModeSwitchHandle,
  ModeSwitchOption,
  ModeSwitchOptions,
  PanelHeaderHandle,
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
export { createWaveformPanel } from './waveformPanel.js';
export type { WaveformPanelHandle, WaveformSeries } from './waveformPanel.js';
