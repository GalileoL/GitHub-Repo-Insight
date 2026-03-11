import type { EChartsOption } from 'echarts';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function getChartTheme(): EChartsOption {
  return {
    backgroundColor: 'transparent',
    textStyle: {
      color: cssVar('--chart-axis-label'),
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
    },
    title: {
      textStyle: { color: cssVar('--chart-tooltip-text') },
    },
    legend: {
      textStyle: { color: cssVar('--chart-axis-label') },
    },
    tooltip: {
      backgroundColor: cssVar('--chart-tooltip-bg'),
      borderColor: cssVar('--chart-tooltip-border'),
      textStyle: { color: cssVar('--chart-tooltip-text'), fontSize: 13 },
    },
    xAxis: {
      axisLine: { lineStyle: { color: cssVar('--chart-axis-line') } },
      axisTick: { lineStyle: { color: cssVar('--chart-axis-line') } },
      axisLabel: { color: cssVar('--chart-axis-label') },
      splitLine: { lineStyle: { color: cssVar('--chart-split-line') } },
    },
    yAxis: {
      axisLine: { lineStyle: { color: cssVar('--chart-axis-line') } },
      axisTick: { lineStyle: { color: cssVar('--chart-axis-line') } },
      axisLabel: { color: cssVar('--chart-axis-label') },
      splitLine: { lineStyle: { color: cssVar('--chart-split-line') } },
    },
  };
}

export function chartColors() {
  return {
    tooltipBg: cssVar('--chart-tooltip-bg'),
    tooltipBorder: cssVar('--chart-tooltip-border'),
    tooltipText: cssVar('--chart-tooltip-text'),
    axisLine: cssVar('--chart-axis-line'),
    axisLabel: cssVar('--chart-axis-label'),
    splitLine: cssVar('--chart-split-line'),
    pieBorder: cssVar('--chart-pie-border'),
  };
}

export function heatmapColors() {
  return {
    empty: cssVar('--heatmap-empty'),
    l1: cssVar('--heatmap-l1'),
    l2: cssVar('--heatmap-l2'),
    l3: cssVar('--heatmap-l3'),
    l4: cssVar('--heatmap-l4'),
    stroke: cssVar('--heatmap-stroke'),
  };
}
