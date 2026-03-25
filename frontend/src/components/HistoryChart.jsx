import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export default function HistoryChart({ data }) {
  const rootRef = useRef(null);

  useEffect(() => {
    const container = rootRef.current;
    if (!container) return undefined;

    const width = container.clientWidth || 640;
    const height = 340;
    const margin = { top: 16, right: 18, bottom: 40, left: 50 };

    d3.select(container).selectAll('*').remove();

    if (!data.length) {
      d3.select(container)
        .append('div')
        .attr('class', 'empty-state')
        .text('Waiting for sensor history...');
      return undefined;
    }

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const parsed = data.map(item => ({
      ...item,
      time: new Date(item._time || item.timestamp),
      temperature: Number(item.temperature || 0),
      humidity: Number(item.humidity || 0),
      air_quality: Number(item.air_quality || 0),
      humidityScaled: Number(item.humidity || 0) / 2,
      airScaled: Number(item.air_quality || 0) / 25,
    }));

    const x = d3.scaleTime().domain(d3.extent(parsed, d => d.time)).range([0, chartWidth]);
    const y = d3
      .scaleLinear()
      .domain([0, 40])
      .nice()
      .range([chartHeight, 0]);

    g.append('g')
      .attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(5).tickSize(-chartWidth).tickFormat(''));

    const line = accessor =>
      d3
        .line()
        .x(d => x(d.time))
        .y(d => y(accessor(d)))
        .curve(d3.curveMonotoneX);

    const series = [
      { color: '#2563eb', label: 'Temperature', accessor: d => d.temperature },
      { color: '#f59e0b', label: 'Humidity / 2', accessor: d => d.humidityScaled },
      { color: '#7c3aed', label: 'Air quality / 25', accessor: d => d.airScaled },
    ];

    series.forEach(item => {
      g.append('path')
        .datum(parsed)
        .attr('fill', 'none')
        .attr('stroke', item.color)
        .attr('stroke-width', 2.2)
        .attr('d', line(item.accessor));
    });

    g.append('g')
      .attr('transform', `translate(0,${chartHeight})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%H:%M:%S')));
    g.append('g').call(d3.axisLeft(y).ticks(5));

    const legend = svg.append('g').attr('transform', `translate(${width - 170}, 20)`);
    series.forEach((item, index) => {
      legend.append('rect').attr('x', 0).attr('y', index * 18).attr('width', 10).attr('height', 10).attr('fill', item.color);
      legend
        .append('text')
        .attr('x', 16)
        .attr('y', index * 18 + 9)
        .attr('fill', '#475569')
        .attr('font-size', '11px')
        .text(item.label);
    });

    return () => {
      d3.select(container).selectAll('*').remove();
    };
  }, [data]);

  return <div ref={rootRef} className="chart-root" />;
}
