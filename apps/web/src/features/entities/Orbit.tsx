import type { EntityEgoNeighbor } from '../../api/client';
import type { Lang } from '../../i18n/tt';

interface OrbitProps {
  centerName: string;
  neighbors: EntityEgoNeighbor[];
  selectedId?: string;
  onSelect: (id: string, name: string) => void;
  lang: Lang;
}

/**
 * Lightweight fixed-ring SVG Orbit visualization (lazy-loaded, zero force-simulation hairballs).
 * Places up to 10 closely associated entities evenly around the center; radius reflects association weight.
 */
export default function Orbit({
  centerName,
  neighbors,
  selectedId,
  onSelect,
  lang,
}: OrbitProps) {
  const top = neighbors.slice(0, 10);
  const maxShared = Math.max(1, ...top.map((n) => n.together || 1));

  const cx = 160;
  const cy = 140;
  const ringR = 94;

  return (
    <div className="rounded-xl border border-rule bg-paper-raised p-2">
      <svg
        viewBox="0 0 320 280"
        className="w-full h-auto block"
        role="img"
        aria-label={centerName}
      >
        {/* Subtle orbit guide circle */}
        <circle
          cx={cx}
          cy={cy}
          r={ringR}
          fill="none"
          stroke="var(--color-rule)"
          strokeDasharray="3 3"
          strokeWidth={1}
        />

        {/* Spokes */}
        {top.map((nb, idx) => {
          const angle = (idx / Math.max(1, top.length)) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(angle) * ringR;
          const y = cy + Math.sin(angle) * ringR;
          const active = selectedId === nb.id;
          return (
            <line
              key={`line-${nb.id}`}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke={active ? 'var(--color-ink)' : 'var(--color-rule-strong)'}
              strokeWidth={active ? 1.8 : 1}
              opacity={active ? 0.9 : 0.45}
            />
          );
        })}

        {/* Center entity node */}
        <circle cx={cx} cy={cy} r={22} fill="var(--color-ink)" />
        <text
          x={cx}
          y={cy + 3}
          textAnchor="middle"
          fontSize="9"
          fill="var(--color-paper)"
          className="font-ui font-medium"
        >
          {centerName.length > 14 ? `${centerName.slice(0, 13)}…` : centerName}
        </text>

        {/* Neighbor nodes */}
        {top.map((nb, idx) => {
          const angle = (idx / Math.max(1, top.length)) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(angle) * ringR;
          const y = cy + Math.sin(angle) * ringR;
          const weight = nb.together || 1;
          const r = 7 + Math.round((weight / maxShared) * 8);
          const active = selectedId === nb.id;
          const name =
            lang === 'bn'
              ? nb.canonicalBn || nb.canonicalEn || nb.id
              : nb.canonicalEn || nb.canonicalBn || nb.id;
          const shortName = name.length > 16 ? `${name.slice(0, 15)}…` : name;
          const labelY = y + (Math.sin(angle) > 0.2 ? r + 11 : -(r + 5));

          return (
            <g
              key={nb.id}
              className="cursor-pointer"
              onClick={() => onSelect(nb.id, name)}
            >
              <circle
                cx={x}
                cy={y}
                r={r}
                fill={active ? 'var(--color-ink)' : 'var(--color-paper-raised)'}
                stroke="var(--color-ink)"
                strokeWidth={active ? 2 : 1.5}
              />
              <text
                x={x}
                y={labelY}
                textAnchor="middle"
                fontSize="9.5"
                fill="var(--color-ink)"
                className="font-ui"
              >
                {shortName}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
