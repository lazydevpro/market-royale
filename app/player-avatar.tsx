type PlayerAvatarProps = {
  seed?: string | null;
  label?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  league?: number;
  active?: boolean;
};

function seedValue(seed: string) {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export default function PlayerAvatar({
  seed,
  label = "Player avatar",
  size = "md",
  league = 0,
  active = false,
}: PlayerAvatarProps) {
  const value = seedValue((seed || "market-royale-player").toLowerCase());
  const palette = value % 6;
  const expression = (value >>> 4) % 4;
  const hat = (value >>> 8) % 4;

  return (
    <span
      className={`mr-avatar mr-avatar-${size} mr-avatar-palette-${palette} mr-avatar-face-${expression} mr-avatar-hat-${hat} mr-avatar-league-${Math.max(0, Math.min(4, league))}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <span className="mr-avatar-glow" aria-hidden="true" />
      <span className="mr-avatar-body" aria-hidden="true">
        <span className="mr-avatar-zip" />
      </span>
      <span className="mr-avatar-head" aria-hidden="true">
        <span className="mr-avatar-ear mr-avatar-ear-left" />
        <span className="mr-avatar-ear mr-avatar-ear-right" />
        <span className="mr-avatar-eye mr-avatar-eye-left" />
        <span className="mr-avatar-eye mr-avatar-eye-right" />
        <span className="mr-avatar-mouth" />
        <span className="mr-avatar-cheek mr-avatar-cheek-left" />
        <span className="mr-avatar-cheek mr-avatar-cheek-right" />
      </span>
      <span className="mr-avatar-hat" aria-hidden="true">
        <span />
      </span>
      {active && <span className="mr-avatar-live" aria-label="Online" />}
    </span>
  );
}
