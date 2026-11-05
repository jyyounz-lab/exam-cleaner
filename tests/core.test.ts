import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeMask, drawMasks, selectRegion, regionBounds, validQuad, initialEdit, changeHistory, sauvola, colorCandidate } from '../src/core.ts';
import { refineInk } from '../src/refine.ts';
import { printLayout } from '../src/printLayout.ts';
import { applyTextPatches, patchBounds, sampleText, type TextPatch } from '../src/textRepair.ts';
import type { Stroke } from '../src/core.ts';
const image = (w = 20, h = 20) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) });

test('局部鉛筆與淡紅藍筆依紙色補選，低模型分數不阻止指定筆跡', () => {
  const img=image(180,140),n=180*140,ai={handwriting:new Float32Array(n),print:new Float32Array(n),workbook:{version:1 as const,confidence:new Uint8Array(n),keep:new Uint8Array(n).fill(1),lines:new Uint8Array(n),crossings:new Uint8Array(n)}};
  for(let i=0;i<n;i++)img.data.set([224,216,199,255],i*4);
  for(let y=30;y<60;y++)for(let dx=0;dx<2;dx++){
    img.data.set([195,188,173,255],(y*180+30+dx)*4);
    img.data.set([215,188,174,255],(y*180+80+dx)*4);
    img.data.set([190,188,199,255],(y*180+130+dx)*4);
  }
  const edit={...initialEdit(),inkType:'workbook' as const,threshold:.5},rect={x:0,y:0,w:1,h:1};
  assert.equal(composeMask(img,edit,ai).count,0);assert.equal(colorCandidate(215,188,174,'red'),false);
  for(const [target,x] of [['pencil',30],['red',80],['blue',130]] as const){
    const selection=selectRegion(img,edit,rect,ai,target),mask=composeMask(img,{...edit,strokes:[selection]},ai).mask;
    assert.equal(mask[40*180+x],255,target);assert.equal(mask[10*180+10],0,'paper stays unchanged');
    for(const other of [30,80,130])if(other!==x)assert.equal(mask[40*180+other],0,'only the explicitly selected ink type');
  }
});

test('連續九框仍可補選淡紅筆，人工保留與印刷框線優先', () => {
  const img=image(240,120),n=240*120,ai={handwriting:new Float32Array(n),print:new Float32Array(n),workbook:{version:1 as const,confidence:new Uint8Array(n),keep:new Uint8Array(n).fill(1),lines:new Uint8Array(n),crossings:new Uint8Array(n)}};
  for(let i=0;i<n;i++)img.data.set([224,216,199,255],i*4);
  for(let k=0;k<9;k++)for(let y=40;y<60;y++)for(let dx=0;dx<2;dx++)img.data.set([215,188,174,255],(y*240+10+k*25+dx)*4);
  ai.workbook.lines[50*240+210]=1;
  const edit={...initialEdit(),inkType:'workbook' as const,threshold:.5},strokes:Stroke[]=[{tool:'protect',radius:.01,points:[{x:185/240,y:50/120}]}];
  for(let k=0;k<9;k++)strokes.push(selectRegion(img,{...edit,strokes},{x:(5+k*25)/240,y:.3,w:15/240,h:.25},ai,'red'));
  const mask=composeMask(img,{...edit,strokes},ai).mask;
  assert.equal(mask[50*240+160],255,'seventh box');assert.equal(mask[50*240+185],0,'manual keep in eighth box');assert.equal(mask[50*240+210],0,'ruling in ninth box');assert.equal(mask[45*240+210],255,'ninth box still accepts other ink');
});

test('局部鉛筆保護深色題目及暈邊，漸層紙面不整片清除', () => {
  const img=image(180,140),n=180*140,ai={handwriting:new Float32Array(n),print:new Float32Array(n)};
  for(let y=0;y<140;y++)for(let x=0;x<180;x++)img.data.set([220+Math.round(x/12),215+Math.round(x/12),200+Math.round(x/12),255],(y*180+x)*4);
  for(let y=30;y<60;y++)for(let x=29;x<=33;x++)img.data.set(x===29||x===33?[150,146,139,255]:[35,35,35,255],(y*180+x)*4);
  const edit={...initialEdit(),threshold:.5},s=selectRegion(img,edit,{x:0,y:0,w:1,h:1},ai,'pencil');
  assert.equal(composeMask(img,{...edit,strokes:[s]},ai).count,0);
});

test('淡紅筆框選及擴張保留交叉的黃綠印刷邊線與深色字', () => {
  const img=image(180,140),n=180*140;
  for(let i=0;i<n;i++)img.data.set([224,216,199,255],i*4);
  for(let y=50;y<53;y++)for(let x=20;x<150;x++)img.data.set([215,188,174,255],(y*180+x)*4);
  for(let y=30;y<80;y++)for(const [x,rgb] of [[60,[210,195,130]],[100,[155,175,130]],[130,[35,35,35]]] as const)for(let dx=0;dx<3;dx++)img.data.set([...rgb,255],(y*180+x+dx)*4);
  const edit={...initialEdit(),threshold:.5},stroke=selectRegion(img,edit,{x:0,y:0,w:1,h:1},null,'red');
  const mask=composeMask(img,{...edit,strokes:[stroke]}).mask;
  assert.equal(mask[51*180+30],255,'faded red ink is accepted without AI');
  for(let y=30;y<80;y++)for(const x of [60,100,130])for(let dx=0;dx<3;dx++)assert.equal(mask[y*180+x+dx],0,'printed colored borders and black text remain protected');
});

test('多框補清除累加於整頁 AI，低門檻和延伸只作用框內，空框不擦紙面', () => {
  const img=image(),ai={handwriting:new Float32Array(400),print:new Float32Array(400)},edit=initialEdit();
  ai.handwriting[42]=.99;ai.handwriting[147]=.65;ai.handwriting[294]=.65;ai.handwriting[168]=.99;ai.print[168]=.99;
  const before=composeMask(img,edit,ai).mask;
  const a=selectRegion(img,{...edit,threshold:.5},{x:.3,y:.3,w:.15,h:.15},ai);
  const b=selectRegion(img,{...edit,threshold:.5},{x:.65,y:.65,w:.15,h:.15},ai);
  const after=composeMask(img,{...edit,strokes:[a,b]},ai).mask;
  assert.equal(after[42],255);assert.equal(after[147],255);assert.equal(after[294],255);assert.equal(after[168],0);
  for(let y=0;y<20;y++)for(let x=0;x<20;x++)if(![a,b].some(s=>{const r=regionBounds(s.rect,20,20);return x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h;}))assert.equal(after[y*20+x],before[y*20+x]);
  const empty=selectRegion(img,edit,{x:.9,y:0,w:.1,h:.1},ai);assert.equal(empty.tool,'region');if(empty.tool==='region')assert.equal(empty.mask.some(Boolean),false);
  assert.deepEqual(composeMask(img,{...edit,threshold:.98,strokes:[a,b,empty]},ai).mask,after,'next settings cannot change saved local candidates');
});

test('局部還原與多框共用操作順序，復原重做及重新載入保留同一遮罩', () => {
  const img=image(),ai={handwriting:new Float32Array(400),print:new Float32Array(400)},edit={...initialEdit(),grow:false};
  ai.handwriting[42]=.99;ai.handwriting[147]=.6;
  const clear=selectRegion(img,{...edit,threshold:.5},{x:.3,y:.3,w:.2,h:.2},ai);
  let h={past:[] as typeof edit[],present:edit,future:[] as typeof edit[]};
  h=changeHistory(h,{...edit,strokes:[clear]});const both=composeMask(img,h.present,ai).mask;
  h=changeHistory(h,{...h.present,strokes:[clear,{tool:'restore-region',rect:{x:0,y:0,w:.2,h:.2}}]});
  assert.equal(composeMask(img,h.present,ai).mask[42],0);assert.equal(composeMask(img,h.present,ai).mask[147],255);
  h=changeHistory(h,'undo');assert.deepEqual(composeMask(img,h.present,ai).mask,both);h=changeHistory(h,'redo');
  assert.deepEqual(composeMask(img,structuredClone(h.present),ai).mask,composeMask(img,h.present,ai).mask);
  const restored={...edit,strokes:[clear,{tool:'restore-region' as const,rect:clear.rect}]};assert.equal(composeMask(img,restored,ai).mask[147],0);
  assert.equal(composeMask(img,{...edit,strokes:[...restored.strokes,clear]},ai).mask[147],255);
  assert.equal(composeMask(img,{...edit,strokes:[clear,{tool:'restore',radius:.02,points:[{x:.35,y:.35}]}]},ai).mask[147],0);
});

test('框選尊重人工保留與同字修補順序，還原框取回底圖且取消框內補字', () => {
  const img=image(),edit={...initialEdit(),grow:false},ai={handwriting:new Float32Array(400).fill(.6),print:new Float32Array(400)};
  const rect={x:.3,y:.3,w:.2,h:.2},clear=selectRegion(img,{...edit,threshold:.5},rect,ai);
  const patch:TextPatch={tool:'text',source:{x:.1,y:.1,w:.15,h:.15},target:{x:.4,y:.4}};
  const restored=drawMasks([patch,{tool:'restore-region',rect}],20,20);assert.equal(restored.patches![168],0);assert.equal(restored.reject[168],1);
  const later=drawMasks([{tool:'restore-region',rect},patch],20,20);assert.equal(later.patches![168],2);
  const cleared=drawMasks([patch,clear],20,20);assert.equal(cleared.patches![168],0);
  const keep:Stroke={tool:'protect',radius:.1,points:[{x:.4,y:.4}]};
  assert.equal(composeMask(img,{...edit,strokes:[keep,clear]},ai).mask[168],0);
  const safe=selectRegion(img,{...edit,threshold:.5,strokes:[keep]},rect,ai);assert.equal(composeMask(img,{...edit,strokes:[safe]},ai).mask[168],0);
});

test('區域遮罩有尺寸驗證，舊版單框進度與新框可以並存', () => {
  const img=image(),ai={handwriting:new Float32Array(400).fill(.9),print:new Float32Array(400)},edit={...initialEdit(),region:{x:0,y:0,w:.2,h:.2}};
  const clear=selectRegion(img,edit,{x:.7,y:.7,w:.2,h:.2},ai);
  assert.equal(composeMask(img,edit,ai).mask[315],0);assert.equal(composeMask(img,{...edit,strokes:[clear]},ai).mask[315],255);
  assert.throws(()=>selectRegion(img,edit,{x:NaN,y:0,w:.2,h:.2},ai),/範圍/);
  if(clear.tool==='region')assert.throws(()=>composeMask(img,{...edit,strokes:[{...clear,imageWidth:10}]},ai),/尺寸/);
});

test('課本局部補清除保留導線修補資訊與印刷保護', () => {
  const img=image(),n=400,workbook={version:1 as const,modelRevision:2,confidence:new Uint8Array(n),keep:new Uint8Array(n),lines:new Uint8Array(n),crossings:new Uint8Array(n)};
  workbook.confidence[147]=180;workbook.lines[147]=1;workbook.crossings[147]=1;workbook.confidence[168]=255;workbook.keep[168]=1;
  const ai={handwriting:new Float32Array(n),print:new Float32Array(n),workbook},edit={...initialEdit(),inkType:'workbook' as const,grow:false};
  const clear=selectRegion(img,{...edit,threshold:.5},{x:.3,y:.3,w:.2,h:.2},ai),result=composeMask(img,{...edit,strokes:[clear]},ai);
  assert.equal(result.mask[147],255);assert.equal(result.guideRepair![147],1);assert.equal(result.mask[168],0);
});

test('被保護的候選不能向周圍紙面擴張，已接受候選不能跨越保護線', () => {
  const img=image(),ai={handwriting:new Float32Array(400),print:new Float32Array(400)};
  ai.handwriting[210]=.99; ai.print[210]=.9;
  assert.equal(composeMask(img,initialEdit(),ai).count,0);
  ai.handwriting.fill(0);ai.print.fill(0);ai.handwriting[209]=.99;
  for(let y=0;y<20;y++)ai.print[y*20+10]=.9;
  const mask=composeMask(img,initialEdit(),ai).mask;
  assert.equal(mask[209],255);assert.equal(mask[210],0);assert.equal(mask[211],0);
});

test('直排題目中模型誤判的字由上下印刷字保護',()=>{
  const img=image(200,200),n=40000,ai={handwriting:new Float32Array(n),print:new Float32Array(n)};
  for(const top of [30,55,80])for(let y=top;y<top+15;y++)for(let x=50;x<60;x++){
    if(x>52&&y>top+2&&y<top+12)continue;
    const i=y*200+x;img.data.set([30,30,30,255],i*4);ai.handwriting[i]=top===55?.99:.05;ai.print[i]=top===55?.01:.9;
  }
  const hints=refineInk(img,ai,sauvola(img));assert.equal(hints.printInk[60*200+51],1);
  assert.equal(composeMask(img,initialEdit(),{...ai,hints}).count,0);
});

test('重複印刷括號即使全被模型判成手寫仍保留，括號內作答可清除',()=>{
  const img=image(320,240),n=320*240,ai={handwriting:new Float32Array(n),print:new Float32Array(n)},bracketPixels:number[]=[];
  for(const cx of [60,140,220]){
    for(let dx=-9;dx<=9;dx++)for(const y of [40+Math.round(dx*dx/18),120-Math.round(dx*dx/18)]){
      const i=y*320+cx+dx;img.data.set([30,30,30,255],i*4);ai.handwriting[i]=.99;bracketPixels.push(i);
    }
    for(let y=65;y<95;y++)for(let x=cx;x<cx+3;x++){
      const i=y*320+x;img.data.set([125,125,125,255],i*4);ai.handwriting[i]=.95;
    }
  }
  const hints=refineInk(img,ai,sauvola(img)),mask=composeMask(img,initialEdit(),{...ai,hints}).mask;
  assert.equal(hints.answerRegions,3);for(const i of bracketPixels){assert.equal(hints.printInk[i],1);assert.equal(mask[i],0);}
  assert.equal(mask[80*320+61],255);
  assert.equal(composeMask(img,{...initialEdit(),autoAnswers:false},{...ai,hints}).mask[80*320+61],0);
});

test('連線題端點與接觸的細筆跡分開保護',()=>{
  const img=image(240,240),n=240*240,ai={handwriting:new Float32Array(n),print:new Float32Array(n)};
  const put=(x:number,y:number)=>{const i=y*240+x;img.data.set([30,30,30,255],i*4);ai.handwriting[i]=.99;};
  for(const cx of [50,100,150]){
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)if(dx*dx+dy*dy<=9)put(cx+dx,50+dy);
    for(let d=1;d<=40;d++){put(cx+Math.floor(d/2),50+d);put(cx+Math.floor(d/2)+1,50+d);}
  }
  const hints=refineInk(img,ai,sauvola(img)),mask=composeMask(img,initialEdit(),{...ai,hints}).mask;
  for(const cx of [50,100,150]){assert.equal(mask[50*240+cx],0);assert.equal(mask[75*240+cx+12],255);}
});

test('零碎細筆與單一弧線不會被重複端點或括號規則保護',()=>{
  const w=300,h=240,n=w*h,strength=new Uint8Array(n);
  for(const cx of [40,100,160])for(let d=0;d<30;d++)for(let dx=0;dx<3;dx++)strength[(50+d)*w+cx+Math.floor(d/2)+dx]=200;
  for(let dx=-9;dx<=9;dx++)strength[(150+Math.round(dx*dx/18))*w+100+dx]=200;
  const result=printLayout(w,h,strength,new Uint8Array(n),new Float32Array(n));
  assert.equal(result.keep.some(Boolean),false);assert.equal(result.pairs,0);
});
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
  assert.equal(composeMask(img,{...edit,threshold:.9},{...ai,hints}).count,0,'higher confidence threshold must reflect the whole stroke, not its best pixel');
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
