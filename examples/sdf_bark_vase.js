// Bark vase — a hollow vessel whose wall is textured with vertical bark
// grooves. Two ideas from the noise toolkit combine here:
//
//  1. `.displace()` takes ANY (x,y,z)=>number field, so we wrap
//     `sdf.noise()` in a closure that squashes the Z coordinate — turning
//     isotropic noise into vertical streaks (bark runs UP the trunk).
//  2. The field is shaped to [-1, 0] so displacement only ever carves
//     INWARD (grooves), never bumps outward. One-sided displacement can't
//     pinch off floating islands, so the thin wall stays one watertight
//     piece — the reliable recipe for textured shells.
const { sdf } = api;

const n = sdf.noise({ seed: 3, frequency: 0.2, octaves: 3, gain: 0.5, ridged: true });
const bark = (x, y, z) => -(n(x, y, z * 0.18) * 0.5 + 0.5);   // vertical, inward-only

// Vase body: a solid cylinder with an inner cavity carved out, leaving a
// closed floor (the cavity is raised so it doesn't punch through the base).
const outer = sdf.cylinder(16, 60);
const cavity = sdf.cylinder(12, 60).translate(0, 0, 9);
const vase = outer.subtract(cavity)
  .displace(1.6, bark)
  .label('bark');

return vase.build({ edgeLength: 0.72 });
