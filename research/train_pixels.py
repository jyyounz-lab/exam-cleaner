"""Train a local pixel classifier with grouped pages and print-touching hard negatives.

Usage: python research/train_pixels.py PRIVATE_PIXEL_DATASET
All data and candidate outputs stay local; this does not replace a public model.
"""
import os
os.environ['OMP_NUM_THREADS']='1'
os.environ['OPENBLAS_NUM_THREADS']='1'
from pathlib import Path
import argparse
import json,hashlib,numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import precision_score,recall_score
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('dataset',type=Path)
root=parser.parse_args().dataset
data=json.loads((root/'manifest.json').read_text(encoding='utf-8'));x=np.fromfile(root/'features.f32',np.float32).reshape(-1,len(data['names']));y=np.fromfile(root/'labels.u8',np.uint8);weights=np.fromfile(root/'weights.f32',np.float32).astype(float)
assert len(x)==len(y)==len(weights) and len(y)>0, 'Pixel dataset lengths must match'
assert np.isfinite(x).all() and np.isfinite(weights).all() and (weights>0).all()
source_splits={}
for p in data['pairs']:source_splits.setdefault(p['sourcePage'],set()).add(p['split'])
assert all(len(s)==1 for s in source_splits.values()), 'Source page variants cross dataset splits'
split=np.zeros(len(y),np.uint8);groups=np.zeros(len(y),int);group_ids={g:i for i,g in enumerate(sorted({p['sourcePage'] for p in data['pairs']}))}
for p in data['pairs']:split[p['start']:p['end']]={'train':0,'validation':1,'test':2}[p['split']];groups[p['start']:p['end']]=group_ids[p['sourcePage']]
for g in np.unique(groups):
 assert len(set(split[groups==g]))==1
 for cls in [0,1]:
  sel=(groups==g)&(y==cls)
  if sel.any():weights[sel]/=weights[sel].sum()
fit=split==0
for cls in [0,1]:weights[fit&(y==cls)]/=weights[fit&(y==cls)].sum()
weights*=fit.sum()/2
model=HistGradientBoostingClassifier(max_iter=160,max_depth=5,max_leaf_nodes=24,min_samples_leaf=30,learning_rate=.08,early_stopping=False,l2_regularization=1,random_state=20261109)
model.fit(x[fit],y[fit],sample_weight=weights[fit]);trees=[]
for stage in model._predictors:
 nodes=stage[0].nodes;trees.append([[-2 if n['is_leaf'] else int(n['feature_idx']),float(n['num_threshold']),int(n['left']),int(n['right']),float(n['value']) if n['is_leaf'] else 0] for n in nodes])
export={'version':1,'kind':'gradient-boosted-pixel-classifier','featureNames':data['names'],'bias':float(model._baseline_prediction[0,0]),'trees':trees,'threshold':.9,'training':{'source':'16 source pages, grouped 11 train / 2 validation / 3 development evaluation; six genuine blank pairs plus ten old weak pairs','sourceGroups':{s:sorted({p['sourcePage'] for p in data['pairs'] if p['split']==s}) for s in ['train','validation','test']},'sampledTrainPixels':int(fit.sum()),'positiveTrainPixels':int(y[fit].sum()),'parameters':{'iterations':160,'maxDepth':5,'maxLeafNodes':24,'minSamplesLeaf':30,'learningRate':.08,'l2':1,'seed':20261109,'pageClassBalancing':True},'featureDataSha256':hashlib.sha256((root/'features.f32').read_bytes()).hexdigest()}}
logits=np.full(len(x),export['bias']);xx=x.astype(np.float64)
for tree in trees:
 t=np.array(tree);idx=np.zeros(len(x),int)
 for _ in range(6):
  active=np.flatnonzero(t[idx,0]>=0)
  if not len(active):break
  f,th,l,r,_=t[idx[active]].T;idx[active]=np.where(xx[active,f.astype(int)]<=th,l,r).astype(int)
 assert np.all(t[idx,0]<0);logits+=t[idx,4]
probs=1/(1+np.exp(-logits));error=float(np.max(abs(probs-model.predict_proba(x)[:,1])));assert error<1e-10,error
export['threshold']=.96
export['training']['source']='Grouped source pages; provenance and label reliability must be reviewed with the private manifest'
export['training']['parameters']['hardNegativeMining']='up to 1600 additional retained-print pixels per training variant from components touching handwriting, weight 4'
report={'exportMaxError':error,'splits':[]}
for s,name in enumerate(['train','validation','test']):
 sel=split==s;report['splits'].append({'split':name,'pixels':int(sel.sum()),'positive':int(y[sel].sum()),'thresholds':[{'threshold':th,'precision':float(precision_score(y[sel],probs[sel]>=th,zero_division=0)),'recall':float(recall_score(y[sel],probs[sel]>=th,zero_division=0))} for th in [.8,.9,.95]]})
(root/'ink-model.json').write_text(json.dumps(export,separators=(',',':')));(root/'training-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2),flush=True)
