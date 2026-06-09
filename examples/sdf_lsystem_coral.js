const { sdf } = api;
const coral = sdf.lsystem({
  axiom: 'A',
  rules: { A: 'F[&A]////[&A]////[&A]////[&A]' },
  iterations: 3,
  angle: 25,
  length: 5,
  radius: 1.8,
  radiusScale: 0.78,
  blend: 1.0,
  label: 'coral',
});
return coral.build({ edgeLength: 0.6 });
