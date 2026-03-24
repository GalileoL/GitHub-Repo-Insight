import { useMemo } from 'react';
import { useECharts } from '../../hooks/useECharts';
import { ChartContainer } from '../common/ChartContainer';
import { chartColors } from '../../utils/echarts-theme';
import { useThemeStore } from '../../store/theme';
import type { LanguageChartData } from '../../utils/transformers';
import type { EChartsOption, TooltipComponentFormatterCallbackParams } from 'echarts';

interface LanguagePieChartProps {
  data: LanguageChartData[] | undefined;
  loading: boolean;
  error: Error | null;
}

export default function LanguagePieChart({ data, loading, error }: LanguagePieChartProps) {
  const themeMode = useThemeStore((s) => s.mode);
  const option = useMemo<EChartsOption | null>(() => {
    if (!data) return null;
    const c = chartColors();
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: c.tooltipBg,
        borderColor: c.tooltipBorder,
        textStyle: { color: c.tooltipText },
        formatter: (params: TooltipComponentFormatterCallbackParams) => {
          if (Array.isArray(params)) return '';
          const d = params.data as { percentage?: number };
          return `${params.name}: ${d?.percentage ?? 0}%`;
        },
      },
      legend: {
        orient: 'vertical',
        right: 10,
        top: 'center',
        textStyle: { color: c.axisLabel },
      },
      series: [
        {
          type: 'pie',
          radius: ['45%', '75%'],
          center: ['35%', '50%'],
          avoidLabelOverlap: true,
          minAngle: 5,
          itemStyle: {
            borderRadius: 6,
            borderColor: c.pieBorder,
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: { show: true, fontSize: 14, fontWeight: 'bold', color: c.tooltipText },
            itemStyle: { shadowBlur: 10, shadowColor: 'rgba(88, 166, 255, 0.3)' },
          },
          data: data.map((item) => ({
            name: item.name,
            value: item.value,
            percentage: item.percentage,
            itemStyle: { color: item.color },
          })),
        },
      ],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- themeMode triggers CSS var changes
  }, [data, themeMode]);

  const chartRef = useECharts(option);

  return (
    <ChartContainer loading={loading} error={error} isEmpty={data?.length === 0} emptyMessage="No language data" skeletonVariant="pie">
      <div ref={chartRef} className="h-full w-full" />
    </ChartContainer>
  );
}
