// Shared between the Node exporter and the browser viewer: the bone list and
// how each bone's pivot + orthonormal frame is read off an `F.rig()` result.
//
// Every bone's frame comes straight from the rig's own FK output (limb dirs,
// elbow/knee hinges, hand splay, head axes, the spine-rotated waist ring), so
// skinned motion uses the same joint math as the SDF builder. A frame
// captured at the rest pose and again at a target pose gives the bone's exact
// rigid transform, including twist.

/** Body options shared by rest pose, animation frames and printable rebuilds. */
export const BODY = { height: 60, headsTall: 7, build: 'average', sex: 'neutral', age: 25, weight: 0.5, muscle: 0 };

/** The bind pose: an A-pose so the arms are clear of the torso when meshed. */
export const REST_POSE = {
  armL: { raiseSide: 40, bend: 8 }, armR: { raiseSide: 40, bend: 8 },
  legL: { raiseSide: 6 }, legR: { raiseSide: 6 },
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Gram-Schmidt frame: x along `primary`, y from `secondary` made ⟂. */
function frame(primary, secondary) {
  const x = norm(primary);
  const s = sub(secondary, x.map((v) => v * dot(secondary, x)));
  const y = norm(s);
  return [x, y, cross(x, y)];
}

/**
 * Bones: name, parent (for the viewer's hierarchy display only), the weight
 * segment (`seg(rig)` → [a, b] endpoints a vertex measures distance to), its
 * influence radius, an optional side (+1 = figure's left, −1 = right) used to
 * stop one leg grabbing the other, and the pose frame `pose(rig)` → {pivot, axes}.
 */
export const BONES = [
  {
    name: 'pelvis',
    seg: (g) => [[0, 0, g.joints.upperLegL[2] - 1], g.joints.spine],
    radius: (g) => g.r.hipsX,
    pose: (g) => ({ pivot: g.joints.hips, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }),
  },
  {
    name: 'chest',
    seg: (g) => [g.joints.spine, g.joints.neck],
    radius: (g) => g.r.chestX,
    // The rig leans the upper body about the navel; the waist ring carries
    // that rotation (it is spine-transformed like the joints).
    pose: (g) => ({ pivot: g.ring.waist.center, axes: [g.ring.waist.xAxis, g.ring.waist.yAxis, g.ring.waist.axis] }),
  },
  {
    name: 'head',
    seg: (g) => [g.joints.chin, g.joints.crown],
    radius: (g) => g.r.head,
    pose: (g) => ({ pivot: g.joints.neck, axes: [g.dir.headLeft, g.dir.headForward.map((v) => -v), g.dir.headUp] }),
  },
  ...[['L', 1], ['R', -1]].flatMap(([s, side]) => [
    {
      name: `upperArm${s}`, side,
      seg: (g) => [g.joints[`upperArm${s}`], g.joints[`lowerArm${s}`]],
      radius: (g) => g.r.upperArm * 1.25,
      pose: (g) => ({ pivot: g.joints[`upperArm${s}`], axes: frame(g.dir[`upperArm${s}`], g.dir[`elbowHinge${s}`]) }),
    },
    {
      name: `lowerArm${s}`, side,
      seg: (g) => [g.joints[`lowerArm${s}`], g.joints[`wrist${s}`]],
      radius: (g) => g.r.lowerArm * 1.25,
      pose: (g) => ({ pivot: g.joints[`lowerArm${s}`], axes: frame(g.dir[`lowerArm${s}`], g.dir[`elbowHinge${s}`]) }),
    },
    {
      name: `hand${s}`, side,
      seg: (g) => {
        const w = g.joints[`wrist${s}`], h = g.joints[`hand${s}`];
        return [w, h.map((v, i) => w[i] + (v - w[i]) * 2.2)];
      },
      radius: (g) => g.r.hand * 0.7,
      pose: (g) => ({ pivot: g.joints[`wrist${s}`], axes: frame(sub(g.joints[`hand${s}`], g.joints[`wrist${s}`]), g.dir[`handSplay${s}`]) }),
    },
    {
      name: `upperLeg${s}`, side,
      seg: (g) => [g.joints[`upperLeg${s}`], g.joints[`lowerLeg${s}`]],
      radius: (g) => g.r.upperLeg * 1.2,
      pose: (g) => ({ pivot: g.joints[`upperLeg${s}`], axes: frame(g.dir[`upperLeg${s}`], g.dir[`kneeHinge${s}`]) }),
    },
    {
      name: `lowerLeg${s}`, side,
      seg: (g) => [g.joints[`lowerLeg${s}`], g.joints[`foot${s}`]],
      radius: (g) => g.r.lowerLeg * 1.2,
      pose: (g) => ({ pivot: g.joints[`lowerLeg${s}`], axes: frame(g.dir[`lowerLeg${s}`], g.dir[`kneeHinge${s}`]) }),
    },
    {
      name: `foot${s}`, side,
      seg: (g) => {
        const a = g.joints[`foot${s}`], f = g.dir[`foot${s}`], L = g.r.footLen * 0.75;
        return [[a[0], a[1], a[2] * 0.5], [a[0] + f[0] * L, a[1] + f[1] * L, a[2] * 0.4]];
      },
      radius: (g) => g.r.foot * 1.1,
      // The rig keeps feet flat, so the foot follows the ankle point; its
      // frame is the shank frame with the heading folded in.
      pose: (g) => ({ pivot: g.joints[`foot${s}`], axes: frame(g.dir[`foot${s}`], [0, 0, 1]) }),
    },
  ]),
];

/** Column-major 3×3 rotation taking the rest frame onto the posed frame. */
export function frameDelta(rest, posed) {
  // R = P · Rᵀ where P, R have the frame axes as columns.
  const out = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += posed[k][i] * rest[k][j];
      out[j * 3 + i] = s;
    }
  }
  return out;
}
