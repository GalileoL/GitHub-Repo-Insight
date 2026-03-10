import { useMemo } from 'react';
import { useECharts } from '../../hooks/useECharts';
import { ChartContainer } from '../common/ChartContainer';
import type { CommitTrendData } from '../../utils/transformers';
import type { EChartsOption } from 'echarts';

interface CommitTrendChartProps {
  data: CommitTrendData[] | undefined;
  loading: boolean;
  error: Error | null;
}

export default function CommitTrendChart({ data, loading, error }: CommitTrendChartProps) {
  const option = useMemo<EChartsOption | null>(() => {
    if (!data) return null;
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1c2128',
        borderColor: '#30363d',
        textStyle: { color: '#f0f6fc' },
      },
      grid: { left: 50, right: 30, top: 20, bottom: 40 },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.week),
        axisLine: { lineStyle: { color: '#30363d' } },
        axisLabel: { color: '#8b949e', rotate: 45, fontSize: 11 },
        axisTick: { lineStyle: { color: '#30363d' } },
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: '#30363d' } },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      series: [
        {
          type: 'line',
          data: data.map((d) => d.commits),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: '#3fb950', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(63, 185, 80, 0.3)' },
                { offset: 1, color: 'rgba(63, 185, 80, 0.02)' },
              ],
            },
          },
        },
      ],
    };
  }, [data]);

  const chartRef = useECharts(option);

  return (
    <ChartContainer loading={loading} error={error} isEmpty={data?.length === 0} emptyMessage="No commit data">
      <div ref={chartRef} className="h-full w-full" />
    </ChartContainer>
  );
}
