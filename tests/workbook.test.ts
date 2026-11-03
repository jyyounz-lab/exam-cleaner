import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {inkFeatureNames} from '../src/inkFeatures.ts';
import {analyseWorkbook,validateWorkbookModel,workbookScore,type WorkbookModel} from '../src/workbook.ts';
import {composeMask,initialEdit,sauvola} from '../src/core.ts';

const certain:WorkbookModel={version:1,featureNames:inkFeatureNames,bias:8,trees:[[[-2,0,-1,-1,0]]]};
const image=(w=800,h=800)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(255)});
const prediction=(n:number)=>({handwriting:new Float32Array(n),print:new Float32Array(n)});

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
