import { ArrowsLeftRight, ArrowCounterClockwise, Selection } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import type { RegionTarget } from './regionInk';

export type BoxAction = RegionTarget | 'restore';
type Props = {
  step: number;
  busy: boolean;
  canCompare: boolean;
  comparing: boolean;
  onCompare: (active: boolean) => void;
  box: BoxAction | '';
  pencil: boolean;
  onBox: (action: BoxAction) => void;
};

export default function ReviewTools({step,busy,canCompare,comparing,onCompare,box,pencil,onBox}:Props) {
  const select = useRef<HTMLSelectElement>(null);
  const focusNextBox = useRef(false);
  useEffect(() => {
    if (step === 2 && focusNextBox.current) select.current?.focus({preventScroll:true});
    focusNextBox.current = false;
  }, [step]);
  function startBox(event:React.MouseEvent, action:BoxAction) {
    focusNextBox.current = event.detail === 0;
    onBox(action);
  }
  return <div className="review-tools" role="group" aria-label="考卷檢查工具">
    <button type="button" className="compare-button" aria-label="按住看清理前" aria-pressed={comparing}
      disabled={busy || !canCompare}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        onCompare(true);
      }}
      onPointerUp={() => onCompare(false)} onPointerCancel={() => onCompare(false)}
      onLostPointerCapture={() => onCompare(false)} onBlur={() => onCompare(false)}
      onClick={event => { if (event.detail === 0) onCompare(!comparing); }}
      onKeyDown={event => {
        if (event.key === 'Escape') onCompare(false);
        if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); onCompare(true); }
      }}
      onKeyUp={event => {
        if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); onCompare(false); }
      }}>
      <ArrowsLeftRight size={17} />{comparing ? '顯示清理前' : '按住看清理前'}
    </button>
    {step === 1 && <div className="review-actions">
      <button disabled={busy} onClick={event => startBox(event,pencil ? 'pencil' : 'none')}><Selection size={16} />補清漏擦</button>
      <button disabled={busy} onClick={event => startBox(event,'restore')}><ArrowCounterClockwise size={16} />還原誤擦</button>
    </div>}
    {step === 2 && <label className="next-box">下個框選
      <select ref={select} disabled={busy} value={box} onChange={event => onBox(event.target.value as BoxAction)}>
        <option value="" disabled>選擇框選工具</option>
        <option value="none">AI 候選</option><option value="pencil">鉛筆</option>
        <option value="red">紅筆</option><option value="blue">藍筆</option>
        <option value="both">紅＋藍</option><option value="restore">還原原圖</option>
      </select>
    </label>}
  </div>;
}
