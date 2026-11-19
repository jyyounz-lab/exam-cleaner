// Horizontal workbook guides encode their slope as 1–5. A dotted vertical
// rule is protected in place and provides no samples for horizontal repair.
export const DOTTED_RULE = 255;

export function markDottedRules(width:number, height:number, contrast:Float32Array, lines:Uint8Array) {
  const scale = Math.min(width, height) / 1108;
  const length = Math.max(32, Math.round(64 * scale));
  const flank = Math.max(3, Math.round(4 * scale));
  const radius = Math.max(1, Math.round(scale));
  const ridge = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = flank; x < width - flank; x++) {
    const i = y * width + x;
    ridge[i] = Math.min(255, Math.max(0, contrast[i] - Math.max(contrast[i-flank], contrast[i+flank])));
  }
  const centers = new Int32Array(length), signal = new Uint8Array(length);
  const step = Math.floor(length / 2), gapLimit = Math.max(4, Math.round(9 * scale));
  for (const slope of [-.08, -.04, 0, .04, .08]) {
    const offsets = Int32Array.from({length}, (_, k) => k * width + Math.round(k * slope));
    const margin = flank + radius + Math.ceil(length * Math.abs(slope));
    for (let y = 0; y + length <= height; y += step) for (let x = margin; x < width - margin; x++) {
      const start = y * width + x;
      let hasInk = false;
      for (let k = step; k < step + gapLimit && !hasInk; k++) {
        const mid = start + offsets[k];
        for (let dx = -radius; dx <= radius; dx++) if (ridge[mid+dx] >= 10) { hasInk = true; break; }
      }
      if (!hasInk) continue;
      let supported = 0;
      for (let k = 0; k < length; k++) {
        const mid = start + offsets[k];
        let best = mid;
        for (let dx = -radius; dx <= radius; dx++) if (ridge[mid+dx] > ridge[best]) best = mid + dx;
        centers[k] = best;
        signal[k] = ridge[best];
        if (signal[k] >= 10) supported++;
        if (k - supported > length * .55) break;
      }
      if (supported < length * .45) continue;
      // Count actual light/dark alternations. A solid pencil stroke can be
      // equally straight, but lacks the regular deep gaps of a printed rule.
      const peaks:number[] = [];
      let high = 0, low = 255, at = 0, rising = true;
      for (let k = 0; k < length; k++) {
        const value = signal[k];
        if (rising) {
          if (value > high) { high = value; at = k; }
          if (high >= 18 && value <= high * .58 && high - value >= 12) {
            peaks.push(at); low = value; rising = false;
          }
        } else {
          low = Math.min(low, value);
          if (value >= 18 && value - low >= 12 && low <= value * .58) {
            high = value; at = k; rising = true;
          }
        }
      }
      if (peaks.length < 7) continue;
      const gaps = peaks.slice(1).map((p,k) => p - peaks[k]);
      const period = [...gaps].sort((a,b) => a-b)[Math.floor(gaps.length / 2)];
      if (period < 2 || period > gapLimit) continue;
      let runStart = 0;
      for (let k = 0; k <= gaps.length; k++) {
        if (k < gaps.length && Math.abs(gaps[k] - period) <= Math.max(1, period * .24)) continue;
        if (k - runStart >= 6 && peaks[k] - peaks[runStart] >= length * .4) {
          for (let row = peaks[runStart]; row <= peaks[k]; row++) {
            const center = centers[row];
            for (let dx = -radius; dx <= radius; dx++) {
              const i = center + dx;
              if (ridge[i] >= 5) lines[i] = DOTTED_RULE;
            }
          }
        }
        runStart = k + 1;
      }
    }
  }
}
