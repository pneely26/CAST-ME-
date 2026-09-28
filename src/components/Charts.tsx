"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";

export function HBarChart({ data, label = "Projects", height }: { data: { name: string; value: number }[]; label?: string; height?: number }) {
  if (data.length === 0) return <div className="px-4 py-8 text-center text-sm text-muted">No data yet.</div>;
  const h = height ?? Math.max(120, data.length * 34 + 30);
  return (
    <div style={{ width: "100%", height: h }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
          <CartesianGrid horizontal={false} stroke="#ecebe7" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#6b6d76" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: "#3d3f47" }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "rgba(31,58,95,0.06)" }} formatter={(v) => [v, label]} contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e4e2dd" }} />
          <Bar isAnimationActive={false} dataKey="value" fill="#1f3a5f" radius={[0, 4, 4, 0]} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
