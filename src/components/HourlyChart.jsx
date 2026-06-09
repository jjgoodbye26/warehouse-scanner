import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function HourlyChart({ data }) {
  if (!data || data.length === 0) {
    return <p className="chart-empty">No data for this period</p>;
  }

  return (
    <div className="hourly-chart">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="count" fill="#2563eb" radius={[3, 3, 0, 0]} name="Scans" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
