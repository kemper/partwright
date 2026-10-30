import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  decimate,
  isClosedLoop,
  strokeSamplePoints,
  summarizeHits,
  describeViewHits,
  parseExportedAnnotationView,
} from '../../src/annotations/annotationViewTypes';
import {
  addStroke,
  clearAll,
  clearDrafts,
  getCount,
  getDrafts,
  getStrokes,
  loadFromSerialized,
  serializeAll,
  serializeDrafts,
  setDraftScope,
  type StrokeAnnotation,
} from '../../src/annotations/annotations';

const circle = (n: number, cx = 0.5, cy = 0.5, r = 0.2): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / (n - 1)) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

describe('annotation view helpers', () => {
  it('decimate keeps both ends and caps the count', () => {
    const pts = Array.from({ length: 100 }, (_, i) => i);
    const d = decimate(pts, 10);
    expect(d).toHaveLength(10);
    expect(d[0]).toBe(0);
    expect(d[9]).toBe(99);
    expect(decimate([1, 2], 10)).toEqual([1, 2]);
  });

  it('isClosedLoop: a circle is closed, a line and a squiggle are not', () => {
    expect(isClosedLoop(circle(40))).toBe(true);
    const line: [number, number][] = Array.from({ length: 20 }, (_, i) => [i / 20, 0.5]);
    expect(isClosedLoop(line)).toBe(false);
    const hook = circle(40).slice(0, 25); // ~220° arc: ends far apart
    expect(isClosedLoop(hook)).toBe(false);
  });

  it('strokeSamplePoints adds interior samples only for closed loops', () => {
    const c = circle(60);
    const open = strokeSamplePoints(c, false);
    const closed = strokeSamplePoints(c, true);
    expect(open.length).toBeLessThanOrEqual(24);
    expect(closed.length).toBeGreaterThan(open.length);
    // Interior points lie inside the circle.
    for (const [x, y] of closed.slice(open.length)) {
      expect(Math.hypot(x - 0.5, y - 0.5)).toBeLessThan(0.2);
    }
  });

  it('summarizeHits folds rays into parts, centroid and bbox', () => {
    const h = summarizeHits({ id: 's1', kind: 'stroke' }, [
      { point: [0, 0, 0], part: 'handle' },
      { point: [2, 0, 4], part: 'handle' },
      { point: [1, 0, 2], part: 'lid' },
      null,
    ]);
    expect(h).toMatchObject({ markId: 's1', samples: 4, hits: 3, centroid: [1, 0, 2] });
    expect(h.parts).toEqual([{ name: 'handle', hits: 2 }, { name: 'lid', hits: 1 }]);
    expect(h.bbox).toEqual({ min: [0, 0, 0], max: [2, 0, 4] });
    const miss = summarizeHits({ id: 't', kind: 'text', text: 'here' }, [null, null]);
    expect(miss).toMatchObject({ hits: 0, text: 'here', parts: [] });
    expect(miss.centroid).toBeUndefined();
  });

  it('describeViewHits reads like a sentence', () => {
    expect(describeViewHits({
      marks2D: [{ id: 'a', kind: 'stroke', color: '#f00', width: 4, points: [], closed: false }, { id: 'b', kind: 'text', color: '#f00', text: 'thinner', at: [0, 0] }],
      hits: [{ markId: 'a', kind: 'stroke', samples: 4, hits: 4, parts: [{ name: 'handle', hits: 4 }] }],
    })).toBe('1 stroke · "thinner" · on handle');
    expect(describeViewHits({
      marks2D: [{ id: 'a', kind: 'stroke', color: '#f00', width: 4, points: [], closed: false }],
      hits: [{ markId: 'a', kind: 'stroke', samples: 4, hits: 0, parts: [] }],
    })).toBe('1 stroke · off the model');
    expect(describeViewHits({ marks2D: [], hits: [] })).toBe('no marks');
  });

  it('parseExportedAnnotationView validates the camera and image', () => {
    const good = {
      createdAt: 1, title: 'V', width: 10, height: 5, image: 'data:image/jpeg;base64,AAAA',
      camera: { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1], fov: 45, aspect: 2 },
      marks: [], marks2D: [], hits: [], context: { objectName: 'Object 1', objectId: 'x' },
    };
    const parsed = parseExportedAnnotationView(good);
    expect(parsed).toMatchObject({ title: 'V', context: { objectName: 'Object 1' } });
    expect(parsed!.context).not.toHaveProperty('objectId');
    expect(parseExportedAnnotationView({ ...good, camera: { ...good.camera, fov: 'x' } })).toBeNull();
    expect(parseExportedAnnotationView({ ...good, image: 'javascript:alert(1)' })).toBeNull();
    expect(parseExportedAnnotationView(null)).toBeNull();
  });

  it('parseExportedAnnotationView drops malformed marks, 2D marks and hits individually', () => {
    const plane = { normal: [0, -1, 0], origin: [0, -2, 0], camera: { position: [0, -10, 0], target: [0, 0, 0], up: [0, 0, 1] } };
    const goodMark = { type: 'stroke', id: 'm', points: [{ x: 0, y: 0, z: 0 }], color: [1, 0, 0], width: 4, camera: plane.camera, plane };
    const v = parseExportedAnnotationView({
      createdAt: 1, title: '  ', width: 10, height: 5, image: 'data:image/png;base64,AA',
      camera: { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1], fov: 45, aspect: 2 },
      marks: [goodMark, { type: 'stroke', id: 'bad' }, null],
      marks2D: [{ id: 'a', kind: 'text', color: '#fff', text: 'hi', at: [0.1, 0.2] }, null, { kind: 'stroke' }],
      hits: [{ markId: 'a', kind: 'text', samples: 5, hits: 1, parts: [{ name: 'p', hits: 1 }] }, {}, { markId: 'b', kind: 'stroke', samples: 1, hits: 1, parts: [null] }],
    })!;
    expect(v.title).toBe('View');
    expect(v.marks.map(m => m.id)).toEqual(['m']);
    expect(v.marks2D.map(m => m.id)).toEqual(['a']);
    expect(v.hits.map(h => h.markId)).toEqual(['a']);
    expect(() => describeViewHits(v)).not.toThrow();
  });
});

const cam = { position: [0, -10, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number] };
function stroke(id: string): StrokeAnnotation {
  return {
    type: 'stroke', id, points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 1)],
    color: [1, 0, 0], width: 4, camera: cam, plane: { normal: [0, -1, 0], origin: [0, -2, 0], camera: cam },
  };
}

describe('annotation draft scope', () => {
  beforeEach(() => {
    setDraftScope(false);
    clearAll();
    clearDrafts();
  });

  it('drafts are invisible to the floating layer and never serialize onto a version', () => {
    addStroke(stroke('floating'));
    setDraftScope(true);
    expect(getCount()).toBe(0);
    addStroke(stroke('draft'));
    expect(getStrokes().map(s => s.id)).toEqual(['draft']);
    expect(serializeAll().map(s => s.id)).toEqual(['floating']);
    expect(serializeDrafts().map(s => s.id)).toEqual(['draft']);
    setDraftScope(false);
    expect(getStrokes().map(s => s.id)).toEqual(['floating']);
    expect(getDrafts()).toHaveLength(1);
  });

  it('a plain load (session/object switch) drops drafts', () => {
    setDraftScope(true);
    addStroke(stroke('draft'));
    setDraftScope(false);
    loadFromSerialized([]);
    expect(getDrafts()).toHaveLength(0);
  });

  it('clearAll only clears the layer in scope; a version load keeps drafts', () => {
    addStroke(stroke('floating'));
    setDraftScope(true);
    addStroke(stroke('draft'));
    clearAll();
    expect(getDrafts()).toHaveLength(0);
    setDraftScope(false);
    expect(getCount()).toBe(1);

    setDraftScope(true);
    addStroke(stroke('draft2'));
    setDraftScope(false);
    loadFromSerialized([], { keepDrafts: true });
    expect(getCount()).toBe(0);
    expect(getDrafts().map(d => d.id)).toEqual(['draft2']);
  });
});
