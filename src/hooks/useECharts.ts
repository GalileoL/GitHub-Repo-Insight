import { useRef, useEffect, useCallback } from 'react';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { PieChart, BarChart, LineChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
} from 'echarts/components';
import type { EChartsOption } from 'echarts';

echarts.use([
  CanvasRenderer,
  PieChart,
  BarChart,
  LineChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
]);

/**
 * A hook that manages an ECharts instance using a callback ref.
 *
 * This avoids a race condition where the container div is not in the DOM
 * when the component first mounts (e.g. ChartContainer shows a loading
 * skeleton instead of children).  A callback ref fires exactly when the
 * element enters or leaves the DOM, so the chart is always initialized at
 * the right time.
 */
export function useECharts(option: EChartsOption | null) {
  const chartRef = useRef<echarts.ECharts | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  // Keep a mutable ref to the latest option so the callback ref can apply
  // it immediately when the container appears.
  const optionRef = useRef<EChartsOption | null>(option);
  optionRef.current = option;

  /**
   * Callback ref — called by React when the <div> mounts (node != null)
   * or unmounts (node == null).
   */
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    // Cleanup any previous instance
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (chartRef.current) {
      chartRef.current.dispose();
      chartRef.current = null;
    }

    if (node) {
      chartRef.current = echarts.init(node, undefined, { renderer: 'canvas' });

      // Apply the current option immediately if available
      if (optionRef.current) {
        chartRef.current.setOption(optionRef.current, true);
      }

      observerRef.current = new ResizeObserver(() => {
        chartRef.current?.resize();
      });
      observerRef.current.observe(node);
    }
  }, []);

  // Update the chart whenever the option object changes
  useEffect(() => {
    if (chartRef.current && option) {
      chartRef.current.setOption(option, true);
    }
  }, [option]);

  // Safety-net cleanup on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return setContainerRef;
}
