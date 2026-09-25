type BeaconIconProps = {
  size?: number;
  active?: boolean;
  className?: string;
};

export function BeaconIcon({
  size = 24,
  active = false,
  className = ""
}: BeaconIconProps) {
  return (
    <svg
      className={`beacon-icon ${active ? "is-active" : ""} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="15.5" stroke="currentColor" strokeOpacity=".24" />
      <circle cx="24" cy="24" r="9.5" stroke="currentColor" strokeOpacity=".48" />
      <circle cx="24" cy="24" r="3.75" fill="currentColor" />
    </svg>
  );
}
