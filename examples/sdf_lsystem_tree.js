const { sdf } = api;
const tree = sdf.lsystem({
  axiom: 'FFA',
  rules: {
    A: 'F[&B]/////[&B]/////[&B]',
    B: 'F[&B]///[&B]L',
  },
  iterations: 4,
  angle: 24,
  length: 6,
  radius: 2.6,
  radiusScale: 0.8,
  blend: 0.5,
  label: 'wood',
  leaf: { symbols: ['L'], radius: 2.4, label: 'leaves' },
});
return tree.build({ edgeLength: 0.8 });
