import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeMask, drawMasks, validQuad, initialEdit, changeHistory, sauvola, colorCandidate } from '../src/core.ts';
import { refineInk } from '../src/refine.ts';
import { applyTextPatches, patchBounds, sampleText, type TextPatch } from '../src/textRepair.ts';
import type { Stroke } from '../src/core.ts';
const image = (w = 20, h = 20) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
test('保留區與排除區在膨脹後仍完全不被清除', () => {
  const img = image(), ai = { handwriting: new Float32Array(400).fill(.99), print: new Float32Array(400) };
  const edit = initialEdit(); edit.strokes = [{ tool: 'protect', radius: .12, points: [{ x: .5, y: .5 }] }, { tool: 'restore', radius: .08, points: [{ x: .25, y: .25 }] }];
  const raw = drawMasks(edit.strokes, 20, 20), result = composeMask(img, edit, ai);
  assert.ok(result.count > 200); for (let i = 0; i < 400; i++) if (raw.keep[i] || raw.reject[i]) assert.equal(result.mask[i], 0);
});
test('框選只限制處理範圍，沒有候選時不擦整塊', () => {
  const img = image(), edit = initialEdit(); edit.region = { x: .25, y: .25, w: .5, h: .5 };
  assert.equal(composeMask(img, edit).count, 0);
  const ai = { handwriting: new Float32Array(400).fill(.95), print: new Float32Array(400) };
  const result = composeMask(img, edit, ai); assert.ok(result.count > 0); assert.equal(result.mask[0], 0); assert.equal(result.mask[210], 255);
});
test('印刷保護可以阻止AI誤刪，人工保留即使關閉印刷保護仍有效', () => {
  const ai = { handwriting: new Float32Array(400).fill(.9), print: new Float32Array(400).fill(.8) };
  const edit = initialEdit(); assert.equal(composeMask(image(), edit, ai).count, 0);
  edit.protectPrint = false; assert.equal(composeMask(image(), edit, ai).count, 400);
  edit.strokes = [{ tool: 'protect', radius: 2, points: [{ x: .5, y: .5 }] }]; assert.equal(composeMask(image(), edit, ai).count, 0);
});
test('筆刷：還原扣除AI候選，補擦可重新加入，取消保留不破壞其他層', () => {
  const p = { x: .5, y: .5 }, strokes = [{ tool: 'restore' as const, radius: .1, points: [p] }, { tool: 'erase' as const, radius: .1, points: [p] }, { tool: 'protect' as const, radius: .1, points: [p] }, { tool: 'unprotect' as const, radius: .1, points: [p] }];
  const result = drawMasks(strokes, 20, 20); assert.equal(result.erase[210], 1); assert.equal(result.reject[210], 0); assert.equal(result.keep[210], 0);
});
test('色彩輔助不把黑字或白紙當紅藍筆', () => {
  assert.equal(colorCandidate(20, 20, 20, 'both'), false); assert.equal(colorCandidate(255, 255, 255, 'both'), false);
  assert.equal(colorCandidate(170, 40, 30, 'red'), true); assert.equal(colorCandidate(35, 65, 180, 'blue'), true);
  assert.equal(colorCandidate(170, 40, 30, 'none'), false);
});
test('遮罩尺寸驗證阻止錯誤座標被套用', () => { assert.throws(() => composeMask(image(), initialEdit(), { handwriting: new Float32Array(4), print: new Float32Array(4) }), /尺寸/); });
test('研究模型預設保留黑灰題目，只有明確答案選區才能納入中性墨色AI候選', () => {
  const img = image(); for (let i = 0; i < img.data.length; i += 4) img.data[i] = img.data[i+1] = img.data[i+2] = 70;
  const ai = { handwriting: new Float32Array(400).fill(.99), print: new Float32Array(400) }, edit = initialEdit();
  assert.equal(composeMask(img, edit, ai).count, 0); edit.allowNeutralInk = true; assert.equal(composeMask(img, edit, ai).count, 0);
  edit.region = { x: .25, y: .25, w: .5, h: .5 }; const result = composeMask(img, edit, ai); assert.ok(result.count > 0); assert.equal(result.mask[0], 0);
  edit.allowNeutralInk = false; edit.region = null; edit.strokes = [{ tool: 'erase', radius: .1, points: [{x:.5,y:.5}] }]; assert.ok(composeMask(img, edit, ai).count > 0);
});
test('四角只接受順序正確、凸形且面積足夠的紙張', () => {
  assert.equal(validQuad([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]), true);
  assert.equal(validQuad([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }]), false);
  assert.equal(validQuad([{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]), false);
});
test('復原與重做涵蓋門檻及人工操作，新修改清除重做分支', () => {
  let h = { past: [] as ReturnType<typeof initialEdit>[], present: initialEdit(), future: [] as ReturnType<typeof initialEdit>[] };
  h = changeHistory(h, { ...h.present, threshold: .9 }); h = changeHistory(h, { ...h.present, color: 'red' });
  h = changeHistory(h, 'undo'); assert.equal(h.present.color, 'none'); h = changeHistory(h, 'undo'); assert.equal(h.present.threshold, .8);
  h = changeHistory(h, 'redo'); assert.equal(h.present.threshold, .9); h = changeHistory(h, { ...h.present, color: 'blue' }); assert.equal(h.future.length, 0);
});
test('Sauvola浮點R=1.0與獨立直接計算一致，白紙不產生墨色', () => {
  const img = image(21, 19); for (let y = 3; y < 17; y++) for (let x = 4; x < 17; x++) if ((x + y) % 3) for (let c = 0; c < 3; c++) img.data[(y * 21 + x) * 4 + c] = 40;
  const output = sauvola(img), reflect = (i: number, n: number): number => i < 0 ? reflect(-i, n) : i >= n ? reflect(2 * n - i - 2, n) : i;
  for (let y = 0; y < 19; y++) for (let x = 0; x < 21; x++) { let sum = 0, sq = 0; for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) { const i = (reflect(y + dy, 19) * 21 + reflect(x + dx, 21)) * 4; const value = img.data[i] / 255; sum += value; sq += value * value; } const mean = sum / 225, sd = Math.sqrt(Math.max(0, sq / 225 - mean * mean)); assert.equal(output[y * 21 + x], Number(img.data[(y * 21 + x) * 4] / 255 < mean * (1 + .2 * (sd - 1)))); }
  assert.equal(sauvola(image()).some(Boolean), false);
});
test('完整彩色筆畫補強不會把長藍筆畫當成表格線', () => {
  const img=image(180,180), n=180*180, ai={handwriting:new Float32Array(n),print:new Float32Array(n)};
  for(let y=40;y<105;y++)for(let x=80;x<84;x++){const i=y*180+x;img.data.set([30,70,170,255],i*4);ai.handwriting[i]=.9;}
  const hints=refineInk(img,ai,sauvola(img)), mask=composeMask(img,initialEdit(),{...ai,hints}).mask;
  for(let y=40;y<105;y++)assert.equal(mask[y*180+81],255);
  assert.equal(hints.structure[70*180+81],0);
});
test('答案區鉛筆可自動選取，印刷題目與底線灰邊仍保留', () => {
  const img=image(180,180), n=180*180;
  for(let x=40;x<=140;x++)for(const [y,v] of [[99,180],[100,50],[101,180]])img.data.set([v,v,v,255],(y*180+x)*4);
  for(let y=70;y<=88;y++)for(let x=75;x<=78;x++)img.data.set([125,125,125,255],(y*180+x)*4);
  for(let y=20;y<30;y++)for(let x=10;x<20;x++)img.data.set([30,30,30,255],(y*180+x)*4);
  const ai={handwriting:new Float32Array(n).fill(.99),print:new Float32Array(n)},hints=refineInk(img,ai,sauvola(img));
  const edit=initialEdit(),mask=composeMask(img,edit,{...ai,hints}).mask;
  assert.ok(hints.answerRegions>0);assert.equal(mask[78*180+76],255);
  for(const y of [99,100,101])assert.equal(mask[y*180+80],0);assert.equal(mask[24*180+14],0);
  edit.autoAnswers=false;assert.equal(composeMask(img,edit,{...ai,hints}).mask[78*180+76],0);
});
test('人工補擦可修正AI錯誤保護，還原題目取回底圖內容，人工保留始終優先',()=>{
  const img=image(),n=400;img.data.fill(80);const ai={handwriting:new Float32Array(n).fill(.99),print:new Float32Array(n).fill(.99)};
  const edit=initialEdit();edit.strokes=[{tool:'erase',radius:.1,points:[{x:.5,y:.5}]}];assert.equal(composeMask(img,edit,ai).mask[210],255);
  edit.strokes.push({tool:'restore',radius:.1,points:[{x:.5,y:.5}]});assert.equal(composeMask(img,edit,ai).mask[210],0);
  edit.strokes.push({tool:'erase',radius:.1,points:[{x:.5,y:.5}]},{tool:'protect',radius:.1,points:[{x:.5,y:.5}]});assert.equal(composeMask(img,edit,ai).mask[210],0);
});

test('無底線黑筆依整段手寫證據選取，補齊低機率筆畫和淡灰邊緣', () => {
  const img=image(160,140),n=160*140,ai={handwriting:new Float32Array(n),print:new Float32Array(n)};
  for(let y=45;y<82;y++)for(let x=70;x<74;x++){
    const i=y*160+x;img.data.set([30,30,30,255],i*4);ai.handwriting[i]=y<70?.98:.1;ai.print[i]=y<70?.01:.5;
    img.data.set([228,228,228,255],(y*160+74)*4);
  }
  const hints=refineInk(img,ai,sauvola(img)), edit=initialEdit();
  const mask=composeMask(img,edit,{...ai,hints}).mask;
  assert.equal(hints.answerRegions,0);assert.equal(mask[78*160+72],255);assert.equal(mask[78*160+74],255);
  edit.strokes=[{tool:'protect',radius:.04,points:[{x:72/160,y:78/140}]}];assert.equal(composeMask(img,edit,{...ai,hints}).mask[78*160+72],0);
});

test('印刷行內誤判為手寫的字元由鄰近印刷排列保護', () => {
  const img=image(160,140),n=160*140,ai={handwriting:new Float32Array(n),print:new Float32Array(n)};
  for(const left of [25,45,65])for(let y=30;y<50;y++)for(let x=left;x<left+12;x++){
    if(x>left+2&&y>32&&y<47)continue;const i=y*160+x;img.data.set([30,30,30,255],i*4);ai.handwriting[i]=left===45?.99:.1;ai.print[i]=left===45?.01:.85;
  }
  const hints=refineInk(img,ai,sauvola(img));assert.equal(hints.printInk[40*160+46],1);
  assert.equal(composeMask(img,initialEdit(),{...ai,hints}).count,0);
});

test('框選黑灰候選使用原始模型，補回後處理曾排除的筆畫', () => {
  const img=image(160,140),n=160*140,ai={handwriting:new Float32Array(n),print:new Float32Array(n)};
  for(let y=40;y<44;y++)for(let x=60;x<64;x++){const i=y*160+x;img.data.set([35,35,35,255],i*4);ai.handwriting[i]=.95;}
  const hints=refineInk(img,ai,sauvola(img)),edit=initialEdit();assert.equal(hints.confidence[41*160+61],0);
  edit.allowNeutralInk=true;edit.region={x:.3,y:.2,w:.2,h:.2};
  assert.equal(composeMask(img,edit,{...ai,hints}).mask[41*160+61],255);
  edit.region=null;assert.equal(composeMask(img,edit,{...ai,hints}).mask[41*160+61],0);
});

test('粗黑模式分開厚筆畫與附近的細印刷字，人工補擦仍可選取細筆', () => {
  const img=image(180,180),n=180*180,ai={handwriting:new Float32Array(n),print:new Float32Array(n)};
  for(let y=50;y<90;y++)for(let x=55;x<95;x++)if(x<62||x>=92){const i=y*180+x;img.data.set([10,10,10,255],i*4);ai.handwriting[i]=.98;}
  const hints=refineInk(img,ai,sauvola(img)),edit={...initialEdit(),inkType:'black' as const};
  const mask=composeMask(img,edit,{...ai,hints}).mask;
  assert.equal(mask[65*180+58],255);assert.equal(mask[65*180+93],0);
  edit.strokes=[{tool:'erase',radius:.02,points:[{x:93/180,y:65/180}]}];assert.equal(composeMask(img,edit,{...ai,hints}).mask[65*180+93],255);
});

test('粗黑直筆畫不會因長度被誤認為細表格線', () => {
  const img=image(200,700),n=200*700,ai={handwriting:new Float32Array(n).fill(.98),print:new Float32Array(n)};
  for(let y=50;y<170;y++)for(let x=75;x<82;x++)img.data.set([20,20,20,255],(y*200+x)*4);
  const hints=refineInk(img,ai,sauvola(img));assert.equal(hints.structure[100*200+78],0);
  assert.equal(composeMask(img,initialEdit(),{...ai,hints}).mask[100*200+78],255);
});

test('同字修補取自原始底圖，配合目標紙色且不改來源與範圍外像素', () => {
  const original=image(), cleaned=image();
  for(let i=0;i<400;i++)original.data.set([250,250,250,255],i*4);
  for(let y=10;y<18;y++)for(let x=10;x<16;x++)cleaned.data.set([200,180,160,255],(y*20+x)*4);
  original.data.set([50,50,50,255],(4*20+4)*4);
  const patch:TextPatch={tool:'text',source:{x:.1,y:.1,w:.3,h:.4},target:{x:.65,y:.7}},strokes=[patch],m=drawMasks(strokes,20,20),snapshot=original.data.slice();
  const result=applyTextPatches(original,cleaned,strokes,m.patches,m.keep);
  assert.deepEqual([...result.data.slice((12*20+12)*4,(12*20+12)*4+4)],[40,36,32,255]);
  assert.deepEqual(original.data,snapshot);
  for(let i=0;i<400;i++)if(!m.patches![i])assert.deepEqual(result.data.slice(i*4,i*4+4),cleaned.data.slice(i*4,i*4+4));
});

test('修補先後順序、補擦、還原和人工保留共用同一操作歷史',()=>{
  const patch:TextPatch={tool:'text',source:{x:.1,y:.1,w:.4,h:.4},target:{x:.6,y:.6}};
  const strokes:Stroke[]=[patch,{...patch,source:{x:.5,y:.1,w:.4,h:.4}}];
  let m=drawMasks(strokes,20,20);assert.equal(m.patches![12*20+12],2);
  strokes.push({tool:'erase',radius:.05,points:[{x:.6,y:.6}]});m=drawMasks(strokes,20,20);assert.equal(m.patches![252],0);assert.equal(m.erase[252],1);
  strokes.push(patch,{tool:'restore',radius:.05,points:[{x:.6,y:.6}]});m=drawMasks(strokes,20,20);assert.equal(m.patches![252],0);assert.equal(m.reject[252],1);
  strokes.push(patch,{tool:'protect',radius:.05,points:[{x:.6,y:.6}]});m=drawMasks(strokes,20,20);
  const original=image(),cleaned=image();original.data[(6*20+6)*4]=0;
  assert.deepEqual(applyTextPatches(original,cleaned,strokes,m.patches,m.keep).data.slice(252*4,252*4+4),cleaned.data.slice(252*4,252*4+4));
  const h=changeHistory({past:[],present:initialEdit(),future:[]},{...initialEdit(),strokes});assert.equal(changeHistory(h,'undo').present.strokes.length,0);assert.equal(changeHistory(changeHistory(h,'undo'),'redo').present.strokes.length,strokes.length);
});

test('靠邊修補裁切目標，來源座標維持對齊且離線資料可還原',()=>{
  const original=image(),cleaned=image(),patch:TextPatch={tool:'text',source:{x:.1,y:.1,w:.4,h:.4},target:{x:0,y:0}};
  original.data.set([0,0,0,255],(6*20+6)*4);
  const strokes:Stroke[]=structuredClone([patch]),m=drawMasks(strokes,20,20),result=applyTextPatches(original,cleaned,strokes,m.patches,m.keep);
  assert.deepEqual(patchBounds(patch,20,20),{sx:2,sy:2,w:8,h:8,x:-4,y:-4});assert.deepEqual([...result.data.slice(0,4)],[0,0,0,255]);
  assert.equal([...m.patches!].filter(Boolean).length,16);
  assert.equal(applyTextPatches(original,cleaned,[],undefined),cleaned);
});


test('取樣快照保留已確認的字形，後續修改來源與暫存還原不會改字',()=>{
  const original=image(),cleaned=image();cleaned.data.set([40,40,40,255],(4*20+4)*4);
  const source={x:.1,y:.1,w:.3,h:.4},sample=sampleText(cleaned,source);
  const patch:TextPatch=structuredClone({tool:'text',source,target:{x:.65,y:.7},sample});
  cleaned.data.set([0,0,0,255],(4*20+4)*4);
  const m=drawMasks([patch],20,20),result=applyTextPatches(original,cleaned,[patch],m.patches,m.keep);
  assert.equal(result.data[(12*20+12)*4],40);assert.equal(sample.data[(2*6+2)*4],40);
  assert.throws(()=>applyTextPatches(original,cleaned,[{...patch,sample:{...sample,width:1}}],m.patches,m.keep),/取樣尺寸/);
});
