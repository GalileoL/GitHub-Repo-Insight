import { useMemo } from 'react';
import { useECharts } from '../../hooks/useECharts';
import { ChartContainer } from '../common/ChartContainer';
import type { IssuePrTrendData } from '../../utils/transformers';
import type { EChartsOption } from 'echarts';

interface IssuePrTrendChartProps {
  data: IssuePrTrendData[] | undefined;
  loading: boolean;
  error: Error | null;
}

export default function IssuePrTrendChart({ data, loading, error }: IssuePrTrendChartProps) {
  const option = useMemo<EChartsOption | null>(() => {
    if (!data) return null;
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1c2128',
        borderColor: '#30363d',
        textStyle: { color: '#f0f6fc' },
      },
      legend: {
        data: ['Issues', 'Pull Requests'],
        textStyle: { color: '#8b949e' },
        top: 0,
      },
      grid: { left: 50, right: 30, top: 40, bottom: 40 },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.date),
        axisLine: { lineStyle: { color: '#30363d' } },
        axisLabel: { color: '#8b949e', rotate: 45, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: '#30363d' } },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      series: [
        {
          name: 'Issues',
          type: 'line',
          data: data.map((d) => d.issues),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: '#f0883e', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(240, 136, 62, 0.2)' },
                { offset: 1, color: 'rgba(240, 136, 62, 0.02)' },
              ],
            },
          },
        },
        {
          name: 'Pull Requests',
          type: 'line',
          data: data.map((d) => d.pullRequests),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: '#bc8cff', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(188, 140, 255, 0.2)' },
                { offset: 1, color: 'rgba(188, 140, 255, 0.02)' },
              ],
            },
          },
        },
      ],
    };
  }, [data]);

  const chartRef = useECharts(option);

  return (
    <ChartContainer loading={loading} error={error} isEmpty={data?.length === 0} emptyMessage="No issue data">
      <div ref={chartRef} className="h-full w-full" />
    </ChartContainer>
  );
}
