export default function GaugeCard({ label, value, unit, tone = 'neutral', helper }) {
  return (
    <div className={`panel gauge-card tone-${tone}`}>
      <div className="eyebrow">{label}</div>
      <div className="gauge-value">
        {value}
        <span>{unit}</span>
      </div>
      {helper ? <div className="helper-text">{helper}</div> : null}
    </div>
  );
}
