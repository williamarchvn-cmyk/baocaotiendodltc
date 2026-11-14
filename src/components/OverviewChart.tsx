import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';

export interface ChartDatum {
  name: string;
  count: number;
  key: string;
  color: string;
}

/** Biểu đồ tổng quan. Tách file riêng để thư viện biểu đồ (nặng) chỉ tải khi cần, không chặn lần hiển thị đầu. */
export default function OverviewChart({ data }: { data: ChartDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 20, right: 10, left: -15, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis
          dataKey="name"
          interval={0}
          tick={{ fill: '#475569', fontSize: 10, fontWeight: '700' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <ChartTooltip
          cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
          contentStyle={{
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: 'rgba(15, 23, 42, 0.95)',
            borderRadius: '12px',
            color: '#ffffff',
            fontSize: '12px',
            fontWeight: 'bold',
            padding: '12px'
          }}
          labelFormatter={(name) => `Đơn vị: ${name}`}
          formatter={(value) => [`${value} ĐLTC`, 'Đang thi công']}
        />
        <Bar dataKey="count" radius={[8, 8, 0, 0]} maxBarSize={48}>
          {data.map((_, index) => (
            <Cell key={`cell-${index}`} fill="rgba(147, 197, 253, 0.85)" stroke="rgba(96, 165, 250, 0.9)" strokeWidth={1.5} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
