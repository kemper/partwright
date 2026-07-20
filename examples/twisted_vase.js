// Twisted vase — one lofted hexagonal-profile solid, twisted in a single warp
const { Curves, geom } = api;

const height = 20;
const steps = 24; // profile samples along the bulge curve (loft interpolates smoothly between them)
const totalTwistDegrees = 90;

const heights = [];
const profiles = [];
for (let i = 0; i <= steps; i++) {
  const t = i / steps;
  const radius = 3 + Math.sin(t * Math.PI) * 3; // same barrel-shaped bulge as the original
  heights.push(t * height);
  profiles.push(geom.ngon(radius, 6));
}

// One smooth, continuous hexagonal profile lofted along the full height —
// replaces the old stack of 40 individually-pre-rotated rings.
let vase = Curves.loft(profiles, heights, { resolution: 64 });

// Twist applied once, as a single mesh warp: rotation grows linearly from 0
// at the base to totalTwistDegrees at the rim, matching the original's
// `twist = t * 90` — but as a continuous helical surface instead of discrete
// pre-rotated slices, so the silhouette is smooth with no stair-step ridges.
vase = api.twist(vase, { degrees: totalTwistDegrees });

return vase;
