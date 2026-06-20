# Partwright — Manifold / CrossSection API Reference

## All constructors

```
Manifold: cube, sphere, cylinder, tetrahedron, extrude, revolve,
          union, difference, intersection, hull, compose, smooth, levelSet, ofMesh
CrossSection: square, circle, ofPolygons (CCW outer, CW holes),
              compose, union, difference, intersection, hull
Curves: arc, bezier, naca4, polyline, loft, sweep, revolveAxis,
        fillet, chamfer, ringCopy, linearCopy, mirrorCopy   (see /ai/curves.md)
sdf: sphere, ellipsoid, box, roundedBox, cylinder, roundedCylinder,
     torus, capsule,
     tube(path, radius, {profile:'flutes'|'rings'|'helix', count, turns, depth, taper}) — directional surface texture along a path,
     gyroid/schwarzP/diamond/lidinoid + their graded* variants (TPMS),
     union/subtract/intersect, smoothUnion/Subtract/Intersect,
     .translate/.rotate/.scale/.mirror, .shell/.round/.twist/.bend/.taper,
     .polarArray/.polarRepeat/.mirrorPair/.repeat/.repeatN,
     .label(name), .build({edgeLength?, bounds?})        (see /ai/sdf.md)
meshOps (flat on api): intersects, contains, pointInside, bbox,
                       componentBounds, volumeDelta,
                       alignTo, placeOn, mirrorAcross, mirrorCopy,
                       linearPattern, circularPattern, spiralPattern,
                       expectUnion, expectDifference, expectComponents,
                       heal
params (flat on api):  api.params(schema) -> resolved values. NATIVE
                       manifold-js feature for parametric / customizable
                       models (also works in voxel + replicad sessions; NOT
                       scad, which uses its own `// [min:max]` customizer
                       comments). Declare knobs at the top, read the returned
                       values in code, and they ALSO surface as a live
                       Customizer panel. You do NOT need SCAD to make a model
                       parametric. Schema types: number/int/boolean/select/
                       text/color. See ai.md "Customizer parameters".
```

## Manifold instance methods

```
Booleans:   .add(other)  .subtract(other)  .intersect(other)  .hull()
Transforms: .translate([x,y,z])  .rotate([rx,ry,rz]) (degrees, applied X->Y->Z)
            .scale(s) or .scale([x,y,z])  .mirror([nx,ny,nz]) (plane normal)
            .warp(fn)  .transform(mat4)
            ^ warp's `fn(v)` MUST MUTATE the vertex IN PLACE: write v[0]=…; v[1]=…; v[2]=…
              — returning a new array (e.g. `v => [x*2, y, z]`) silently does NOTHING.
              For surface texture that follows a path, prefer `api.sdf.tube(...)` over warp.
Mesh ops:   .refine(n)  .simplify(tolerance)  .smoothOut(minSharpAngle?, minSmoothness?)
            .calculateNormals(idx, angle?)
Queries:    .volume()  .surfaceArea()  .genus()  .numVert()  .numTri()  .isEmpty()
            .boundingBox()  .status() (0=valid)  .decompose()
Slicing:    .slice(z)  .project()  .trimByPlane(n,off)  .splitByPlane(n,off)
Output:     .getMesh() -> {vertProperties, triVerts, numVert, numTri, numProp}
```

## CrossSection instance methods

```
2D->3D:      .extrude(h, nDiv?, twist?, scaleTop?, center?)  .revolve(n?, degrees?)
Transforms: .translate([x,y])  .rotate(degrees)  .scale(s or [x,y])
            .mirror([nx,ny])  .warp(fn)  .transform(mat3)
Booleans:   .add(other)  .subtract(other)  .intersect(other)  .hull()
Modify:     .offset(delta, joinType?, miterLimit?, segments?)  .simplify(epsilon?)
Queries:    .area()  .isEmpty()  .numVert()  .numContour()  .bounds()
Output:     .toPolygons()  .decompose()  .delete()
```
