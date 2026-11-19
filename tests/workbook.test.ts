import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {inkFeatureNames} from '../src/inkFeatures.ts';
import {analyseWorkbook,validateWorkbookModel,workbookScore,type WorkbookModel} from '../src/workbook.ts';
import {composeMask,initialEdit,sauvola,selectRegion} from '../src/core.ts';
import {DOTTED_RULE,markDottedRules} from '../src/dottedRules.ts';
import {pixelFeatures,pixelFeatureNames} from '../src/pixelFeatures.ts';
import {analyseZhuyin,validateZhuyinModel} from '../src/zhuyin.ts';

const certain:WorkbookModel={version:1,featureNames:inkFeatureNames,bias:8,trees:[[[-2,0,-1,-1,0]]]};
const image=(w=800,h=800)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(255)});
const prediction=(n:number)=>({handwriting:new Float32Array(n),print:new Float32Array(n)});

test('注音像素模型格式、局部特徵與模型切換隔離',()=>{
  const model=validateZhuyinModel(JSON.parse(fs.readFileSync('public/models/zhuyin-ink-v1.json','utf8')));
  assert.equal(model.revision,3);assert.equal(model.trees.length,160);assert.equal(model.featureNames.length,37);
  assert.throws(()=>validateWorkbookModel(model));assert.throws(()=>validateZhuyinModel(certain));
  const img=image(20,20),raw=prediction(400),contrast=new Float32Array(400).fill(10);
  const features=pixelFeatures(0,new Array(27).fill(0),img,raw,contrast);
  assert.equal(features.length,37);assert.equal(features[34],10);assert.equal(features[35],10);assert.ok(features.every(Number.isFinite));
  const hints={version:1 as const,modelRevision:3,confidence:new Uint8Array(400).fill(255),keep:new Uint8Array(400),lines:new Uint8Array(400),crossings:new Uint8Array(400)};
  assert.equal(composeMask(img,{...initialEdit(),inkType:'workbook'},{...raw,workbook:hints}).count,0);
  assert.equal(composeMask(img,{...initialEdit(),inkType:'zhuyin'},{...raw,workbook:hints}).count,400);
  assert.equal(composeMask(img,{...initialEdit(),inkType:'zhuyin'},{...raw,workbook:{...hints,modelRevision:2}}).count,0);
  const cached={...raw,workbook:hints,workbooks:{2:{...hints,modelRevision:2,confidence:new Uint8Array(400)},3:hints}};
  assert.equal(composeMask(img,{...initialEdit(),inkType:'workbook'},cached).count,0);
  assert.equal(composeMask(img,{...initialEdit(),inkType:'zhuyin'},cached).count,400,'undo/redo mode changes can reuse both cached results');
});

test('逐像素判斷能分開相連筆畫，保留深色印刷與框線',()=>{
  const img=image(200,200),raw=prediction(40000);
  for(let y=70;y<110;y++)for(let x=60;x<66;x++)img.data.set([25,25,25,255],(y*200+x)*4);
  for(let x=66;x<100;x++)for(let d=0;d<3;d++)img.data.set([150,150,150,255],((87+Math.floor((x-66)/2)+d)*200+x)*4);
  const model:WorkbookModel={version:1,revision:3,featureNames:pixelFeatureNames,bias:0,trees:[[[28,90,1,2,0],[-2,0,0,0,-8],[-2,0,0,0,8]]]};
  const hints=analyseZhuyin(img,raw,sauvola(img),model),mask=composeMask(img,{...initialEdit(),inkType:'zhuyin',threshold:.96},{...raw,workbook:hints}).mask;
  assert.equal(mask[95*200+80],255);assert.equal(mask[88*200+63],0);assert.equal(mask[88*200+65],0,'growth must preserve attached dark print');
  const restored=composeMask(img,{...initialEdit(),inkType:'zhuyin',threshold:.96,strokes:[{tool:'restore-region',rect:{x:.35,y:.4,w:.2,h:.1}}]},{...raw,workbook:hints});
  assert.equal(restored.mask[95*200+80],0);
});

test('切換與復原模式後，鉛筆框採用當前模型的導線與交叉證據',()=>{
  const w=64,n=w*w,img=image(w,w),raw=prediction(n),i=32*w+32;
  for(let y=20;y<45;y++)img.data.set([205,205,205,255],(y*w+32)*4);
  const english={version:1 as const,modelRevision:2,confidence:new Uint8Array(n),keep:new Uint8Array(n),lines:new Uint8Array(n),crossings:new Uint8Array(n)};
  english.lines[i]=3;
  const chinese={...english,modelRevision:3,crossings:english.crossings.slice()};chinese.crossings[i]=1;
  const ai={...raw,workbook:chinese,workbooks:{2:english,3:chinese}};
  const rect={x:0,y:0,w:1,h:1};
  for(const [mode,expected] of [['workbook',0],['zhuyin',255],['auto',255],['workbook',0]] as const) {
    const stroke=selectRegion(img,{...initialEdit(),inkType:mode},rect,ai,'pencil');
    assert.ok(stroke.tool==='region');assert.equal(stroke.mask[i],expected,mode);
  }
});

test('鉛筆框補選深淺變化的手寫，保留同色印刷與手動保留區',()=>{
  const w=80,n=w*w,img=image(w,w),raw=prediction(n),confidence=new Uint8Array(n);
  for(const x of [20,40,60])for(let y=20;y<60;y++){
    const i=y*w+x;
    img.data.set([118,118,118,255],4*i);confidence[i]=242;
    raw.handwriting[i]=x===40?.03:.97;raw.print[i]=x===40?.96:.01;
  }
  const workbook={version:1 as const,modelRevision:3,confidence,keep:new Uint8Array(n),lines:new Uint8Array(n),crossings:new Uint8Array(n)};
  const stroke=selectRegion(img,{...initialEdit(),inkType:'zhuyin',threshold:.7,strokes:[{tool:'protect',radius:.04,points:[{x:.75,y:.5}]}]},{x:0,y:0,w:1,h:1},{...raw,workbook},'pencil');
  assert.ok(stroke.tool==='region');assert.equal(stroke.mask[40*w+20],255);assert.equal(stroke.mask[40*w+40],0);assert.equal(stroke.mask[40*w+60],0);
  const english=selectRegion(img,{...initialEdit(),inkType:'workbook',threshold:.7},{x:0,y:0,w:1,h:1},{...raw,workbook:{...workbook,modelRevision:2}},'pencil');
  assert.ok(english.tool==='region');assert.equal(english.mask[40*w+20],0);
});

test('中文模式只補強兩項模型都有手寫證據的近門檻灰筆',()=>{
  const w=180,img=image(w,w),raw=prediction(w*w);
  for(const x of [40,100])for(let y=50;y<85;y++)for(let dx=0;dx<2;dx++){
    const i=y*w+x+dx;img.data.set([205,205,205,255],4*i);
    raw.handwriting[i]=x===40?.98:.24;raw.print[i]=x===40?.01:.68;
  }
  const nearThreshold:WorkbookModel={version:1,revision:3,featureNames:pixelFeatureNames,bias:Math.log(241/14),trees:[[[-2,0,-1,-1,0]]]};
  const workbook=analyseZhuyin(img,raw,sauvola(img),nearThreshold);
  const {mask}=composeMask(img,{...initialEdit(),inkType:'zhuyin',threshold:.96},{...raw,workbook});
  assert.equal(mask[65*w+40],255);assert.equal(mask[65*w+100],0);
});

test('中文模式辨識連續等距虛線，保留旁邊的直筆畫與空隙供編輯',()=>{
  const w=300,h=300,c=new Float32Array(w*h),lines=new Uint8Array(w*h);
  for(let y=20;y<275;y++) {
    const x=100+Math.round(y*.04);
    if(y%4<2)c[y*w+x]=62;
    c[y*w+160]=52;
  }
  markDottedRules(w,h,c,lines);
  let protectedDashes=0;
  for(let y=30;y<250;y++) {
    const i=y*w+100+Math.round(y*.04);
    if(y%4<2)protectedDashes+=Number(lines[i]===DOTTED_RULE);
    else assert.equal(lines[i],0);
    assert.equal(lines[y*w+160],0);
  }
  assert.ok(protectedDashes>=65);
});

test('訓練模型格式與節點驗證，拒絕循環和非有限值',()=>{
  const model=validateWorkbookModel(JSON.parse(fs.readFileSync('public/models/workbook-ink-v2.json','utf8')));
  assert.equal(model.trees.length,120);assert.equal(model.revision,2);assert.equal(workbookScore(new Array(inkFeatureNames.length).fill(0),model)>0,true);
  assert.throws(()=>validateWorkbookModel({...certain,trees:[[[0,0,0,0,0]]]}));
  assert.throws(()=>validateWorkbookModel({...certain,bias:NaN}));
  assert.throws(()=>validateWorkbookModel({...certain,revision:0}));
  assert.throws(()=>validateWorkbookModel({...certain,featureNames:[]}));
});

test('課本模式保留勾選框，清除框內被模型接受的筆跡',()=>{
  const img=image(),w=img.width,n=w*img.height,raw=prediction(n),frame:number[]=[];
  for(let y=100;y<130;y++)for(let x=100;x<130;x++)if(x<102||x>=128||y<102||y>=128){const i=y*w+x;img.data.set([65,90,130,255],i*4);frame.push(i);}
  for(let d=0;d<15;d++)for(let dx=0;dx<2;dx++){const i=(116-Math.floor(d/2))*w+108+d+dx;img.data.set([160,155,150,255],i*4);}
  for(let d=0;d<60;d++)for(let dx=0;dx<2;dx++){const i=(110-Math.floor(d/2))*w+122+d+dx;img.data.set([150,90,100,255],i*4);}
  const workbook=analyseWorkbook(img,raw,sauvola(img),certain),mask=composeMask(img,{...initialEdit(),inkType:'workbook',threshold:.9},{...raw,workbook}).mask;
  for(const i of frame)assert.equal(mask[i],0,'checkbox frame must survive');
  assert.equal(mask[114*w+112],255,'accepted interior pencil should clear');
});

test('課本模型保護密集線條插圖，原模式不受新模型分數影響',()=>{
  const img=image(),w=img.width,raw=prediction(w*img.height);
  for(let y=200;y<290;y++)for(let x=200;x<290;x++)if((x+y)%8<2||(x-y+800)%8<2)img.data.set([170,165,160,255],(y*w+x)*4);
  const workbook=analyseWorkbook(img,raw,sauvola(img),certain);
  assert.equal(composeMask(img,{...initialEdit(),inkType:'workbook'},{...raw,workbook}).count,0);
  assert.deepEqual(composeMask(img,initialEdit(),raw).mask,composeMask(img,initialEdit(),{...raw,workbook}).mask);
});

test('課本遮罩門檻連續生效，人工保留、還原與限定區域優先',()=>{
  const img=image(20,20),n=400,raw=prediction(n),workbook={version:1 as const,confidence:new Uint8Array(n).fill(205),keep:new Uint8Array(n),lines:new Uint8Array(n),crossings:new Uint8Array(n)};
  const edit={...initialEdit(),inkType:'workbook' as const,grow:false};
  assert.equal(composeMask(img,{...edit,threshold:.9},{...raw,workbook}).count,0);
  assert.equal(composeMask(img,{...edit,threshold:.8},{...raw,workbook}).count,400);
  const strokes=[{tool:'protect' as const,radius:.1,points:[{x:.5,y:.5}]}];
  assert.equal(composeMask(img,{...edit,strokes},{...raw,workbook}).mask[210],0);
  assert.equal(composeMask(img,{...edit,strokes:[{...strokes[0],tool:'restore'}]},{...raw,workbook}).mask[210],0);
  assert.equal(composeMask(img,{...edit,region:{x:0,y:0,w:.2,h:.2}},{...raw,workbook}).mask[210],0);
  assert.equal(composeMask(img,edit,raw).count,0,'legacy draft needs new analysis, never silently use the old model');
  assert.throws(()=>composeMask(img,edit,{...raw,workbook:{...workbook,confidence:new Uint8Array(1)}}));
});

test('課本模式保留縮圖後分離的寬厚彩色插圖片段',()=>{
  const img=image(),w=img.width,raw=prediction(w*img.height);
  for(let y=200;y<245;y++)for(let x=190;x<275;x++)if(Math.abs(x-205-(y-200)*1.2)<7)img.data.set([90,115,155,255],(y*w+x)*4);
  const workbook=analyseWorkbook(img,raw,sauvola(img),certain);
  assert.equal(composeMask(img,{...initialEdit(),inkType:'workbook',threshold:.5},{...raw,workbook}).count,0);
  for(let y=175;y<275;y++)for(let x=175;x<300;x++)img.data.set([240,230,190,255],(y*w+x)*4);
  for(let y=200;y<245;y++)for(let x=190;x<275;x++)if(Math.abs(x-205-(y-200)*1.2)<7)img.data.set([120,110,90,255],(y*w+x)*4);
  const pencil=analyseWorkbook(img,raw,sauvola(img),certain);
  assert.equal(composeMask(img,{...initialEdit(),inkType:'workbook',threshold:.5},{...raw,workbook:pencil}).mask[220*w+229],255,'handwriting over a coloured background must remain selectable');
});

test('彩色導線交叉處由兩側實際線色修補，範圍外與單側證據保持原樣',()=>{
  const sandbox:any={self:{},setTimeout};vm.runInNewContext(fs.readFileSync('public/cv.worker.v4.js','utf8'),sandbox);
  const img=image(80,40),n=3200,mask=new Uint8Array(n),guides=new Uint8Array(n),crossings=new Uint8Array(n);
  for(let x=5;x<75;x++){const i=20*80+x;img.data.set([160,90,100,255],i*4);guides[i]=3;}
  const i=20*80+40;img.data.set([60,60,60,255],i*4);mask[i]=255;crossings[i]=1;
  const output=img.data.slice();sandbox.repairGuides(img,output,mask,guides,crossings);
  assert.deepEqual([...output.slice(i*4,i*4+4)],[160,90,100,255]);
  for(let j=0;j<n;j++)if(j!==i)assert.deepEqual(output.slice(j*4,j*4+4),img.data.slice(j*4,j*4+4));
  for(let x=0;x<40;x++)guides[20*80+x]=0;
  sandbox.repairGuides(img,output,mask,guides,crossings);assert.deepEqual([...output.slice(i*4,i*4+4)],[60,60,60,255]);
});
