import type { EChartsOption } from 'echarts';

export const darkTheme: EChartsOption = {
  backgroundColor: 'transparent',
  textStyle: {
    color: '#8b949e',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
  },
  title: {
    textStyle: { color: '#f0f6fc' },
  },
  legend: {
    textStyle: { color: '#8b949e' },
  },
  tooltip: {
    backgroundColor: '#1c2128',
    borderColor: '#30363d',
    textStyle: { color: '#f0f6fc', fontSize: 13 },
  },
  xAxis: {
    axisLine: { lineStyle: { color: '#30363d' } },
    axisTick: { lineStyle: { color: '#30363d' } },
    axisLabel: { color: '#8b949e' },
    splitLine: { lineStyle: { color: '#21262d' } },
  },
  yAxis: {
    axisLine: { lineStyle: { color: '#30363d' } },
    axisTick: { lineStyle: { color: '#30363d' } },
    axisLabel: { color: '#8b949e' },
    splitLine: { lineStyle: { color: '#21262d' } },
  },
};
