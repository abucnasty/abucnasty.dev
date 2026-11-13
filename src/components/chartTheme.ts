/**
 * Theme + palette for interactive benchmark charts.
 *
 * Scenario colors use the colorblind-friendly palette from belt-charts
 * (`src/charts/constants.ts`) — each scenario gets a distinct color in a
 * fixed cycle so visual identity stays consistent across pages.
 */

export const beltChartsColors = {
  blue: '#0072B2',
  orange: '#E69F00',
  yellow: '#F0E442',
  green: '#009E73',
  sky_blue: '#56B4E9',
  vermillion: '#D55E00',
  reddish_purple: '#CC79A7',
  dark_grey: '#585858',
} as const;

/**
 * Cycle order chosen for maximum hue separation between adjacent scenarios.
 */
export const scenarioPalette: string[] = [
  beltChartsColors.blue,
  beltChartsColors.orange,
  beltChartsColors.green,
  beltChartsColors.reddish_purple,
  beltChartsColors.sky_blue,
  beltChartsColors.vermillion,
  beltChartsColors.yellow,
  beltChartsColors.dark_grey,
];

/**
 * Per-metric color (from belt-charts metricStyles). When charting a single
 * metric across many scenarios this isn't used — scenario colors win — but
 * exposed for any future metric-overlay views.
 */
export const metricColors: Record<string, string> = {
  entityUpdate: beltChartsColors.blue,
  trains: beltChartsColors.yellow,
  controlBehaviorUpdate: beltChartsColors.reddish_purple,
  transportLinesUpdate: beltChartsColors.green,
  electricHeatFluidCircuitUpdate: beltChartsColors.orange,
  spacePlatforms: beltChartsColors.vermillion,
  particleUpdate: beltChartsColors.sky_blue,
  electricNetworkUpdate: '#F4B860', // unfriendly orange_light
  fluidFlowUpdate: '#8A5F00', // unfriendly orange_dark
  heatNetworkUpdate: '#E63946', // unfriendly red
};

export const metricLabels: Record<string, string> = {
  wholeUpdate: 'Whole Update',
  latencyUpdate: 'Latency Update',
  gameUpdate: 'Game Update',
  planetsUpdate: 'Planets Update',
  controlBehaviorUpdate: 'Control Behavior Update',
  transportLinesUpdate: 'Transport Lines Update',
  electricHeatFluidCircuitUpdate: 'Electric/Heat/Fluid Circuit Update',
  electricNetworkUpdate: 'Electric Network Update',
  heatNetworkUpdate: 'Heat Network Update',
  fluidFlowUpdate: 'Fluid Flow Update',
  entityUpdate: 'Entity Update',
  particleUpdate: 'Particle Update',
  spacePlatforms: 'Space Platforms',
  trains: 'Trains',
};

export function metricLabel(name: string): string {
  return metricLabels[name] ?? name;
}

export function scenarioColor(index: number): string {
  return scenarioPalette[index % scenarioPalette.length];
}
