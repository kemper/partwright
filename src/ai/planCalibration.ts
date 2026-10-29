// Where plan-mode builds record estimate vs actual (#1209): a small ring in
// localStorage, shared by every tab of this browser. It is a history of the
// planner's accuracy, not session state, so tabs appending to it doesn't
// change what another tab's session does — only how its next plan is told to
// calibrate.

import { getConfig } from '../config/appConfig';
import type { CalibrationRecord } from './planEstimate';

const STORAGE_KEY = 'partwright.planCalibration';

export function loadCalibration(): CalibrationRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((r): r is CalibrationRecord => !!r && typeof r === 'object'
        && typeof (r as CalibrationRecord).roundsMax === 'number' && typeof (r as CalibrationRecord).actualRounds === 'number')
      : [];
  } catch {
    return [];
  }
}

export function appendCalibration(record: CalibrationRecord): void {
  try {
    const max = Math.max(1, getConfig().ai.planCalibrationMaxEntries);
    const next = [...loadCalibration(), record].slice(-max);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: calibration is a nicety, never a failure.
  }
}
