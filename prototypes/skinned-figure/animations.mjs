// Animations expressed in the RIG's own pose parameters (the same fields
// F.rig({ pose }) and the Character Creator spec take). Because every frame is
// a real rig pose, any frame can be rebuilt as a watertight, printable SDF
// figure: the skinned mesh is only the fast preview of that pose.
const TAU = Math.PI * 2;
const pos = (x) => Math.max(0, x);
const r1 = (x) => Math.round(x * 10) / 10;

function finish(p) {
  // Round so a snapshot reads cleanly and rebuilds byte-identically.
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    out[k] = Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, r1(vv)]));
  }
  return out;
}

export const ANIMATIONS = {
  walk: {
    seconds: 1.15,
    pose(t) {
      const p = t * TAU;
      const leg = (ph) => ({
        raiseSide: 4,
        raiseFwd: 24 * Math.sin(ph),
        // The knee folds while the leg swings forward, straightens for heel strike.
        bend: 6 + 52 * Math.pow(pos(Math.cos(ph - 0.35)), 2.2) * (Math.sin(ph) < 0.6 ? 1 : 0.7),
      });
      const arm = (ph) => ({ raiseSide: 10, raiseFwd: -20 * Math.sin(ph), bend: 14 + 16 * pos(-Math.sin(ph)) });
      return finish({
        legL: leg(p), legR: leg(p + Math.PI),
        armL: arm(p), armR: arm(p + Math.PI),
        spine: { lean: 4, turn: 5 * Math.sin(p), side: 0 },
        head: { yaw: -4 * Math.sin(p), pitch: 2, roll: 0 },
      });
    },
  },
  wave: {
    seconds: 1.4,
    pose(t) {
      const p = t * TAU;
      return finish({
        armR: { raiseSide: 145, raiseFwd: 10, bend: 40 + 28 * Math.sin(p * 2), twist: 60 },
        armL: { raiseSide: 10, bend: 8 },
        legL: { raiseSide: 5 }, legR: { raiseSide: 9, bend: 10 },
        spine: { lean: 0, turn: -6, side: -5 + 2 * Math.sin(p) },
        head: { yaw: -10, pitch: -4, roll: 6 * Math.sin(p) },
      });
    },
  },
  jumpingJacks: {
    seconds: 1.0,
    pose(t) {
      const s = 0.5 - 0.5 * Math.cos(t * TAU);   // 0 closed → 1 open
      return finish({
        armL: { raiseSide: 12 + 148 * s, bend: 10 }, armR: { raiseSide: 12 + 148 * s, bend: 10 },
        legL: { raiseSide: 4 + 18 * s, bend: 8 * (1 - s) }, legR: { raiseSide: 4 + 18 * s, bend: 8 * (1 - s) },
        spine: { lean: 0, turn: 0, side: 0 },
        head: { yaw: 0, pitch: -6 * s, roll: 0 },
      });
    },
  },
  kick: {
    seconds: 1.6,
    pose(t) {
      // Chamber → snap → recoil, on the left leg, guard up.
      const e = t < 0.35 ? t / 0.35 : t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
      const snap = t < 0.3 ? 0 : t < 0.45 ? (t - 0.3) / 0.15 : t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.25);
      return finish({
        legL: { raiseSide: 6, raiseFwd: 85 * e, bend: 110 * e * (1 - snap) + 8 * snap },
        legR: { raiseSide: 8, bend: 14 * e },
        armL: { raiseSide: 14, raiseFwd: 30, bend: 100 },
        armR: { raiseSide: 22, raiseFwd: 22, bend: 110 },
        spine: { lean: -10 * e, turn: 8 * e, side: 0 },
        head: { yaw: 0, pitch: 4 * e, roll: 0 },
      });
    },
  },
};
