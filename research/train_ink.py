"""Train a small supervised component classifier; export plain JSON, never pickle.

Private paired photographs are not included in source or browser assets. Labels
are sparse weak labels checked against semantic ROIs; metrics are not page accuracy.
"""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import precision_score, recall_score


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('dataset', type=Path)
    args = parser.parse_args()
    source = args.dataset / 'features.json'
    data = json.loads(source.read_text('utf-8'))
    rows = [r for r in data['records'] if r['label'] is not None]
    train = [r for r in rows if r['split'] == 'train']
    x = np.array([r['features'] for r in train])
    y = np.array([r['label'] for r in train])
    assert set(y) == {0, 1}
    pages = {split: sorted({r['page'] for r in rows if r['split'] == split}) for split in ['train','validation','test']}
    assert not (set(pages['train']) & (set(pages['test']) | set(pages['validation'])))
    # Weight classes, while preventing a single large component from dominating.
    weights = np.array([np.sqrt(min(r['size'], 300)) for r in train])
    # Explicitly confirmed printed exemplars carry more evidence than weak pair labels.
    weights *= np.array([12 if r.get('confirmedKeep', 0) >= 5 and r['label'] == 0 else 1 for r in train])
    for cls in [0, 1]:
        weights[y == cls] /= weights[y == cls].sum()
    weights *= len(weights) / 2
    model = GradientBoostingClassifier(n_estimators=120, learning_rate=.08, max_depth=3, min_samples_leaf=5, random_state=20261102)
    model.fit(x, y, sample_weight=weights)
    trees = []
    for estimator in model.estimators_[:, 0]:
        t = estimator.tree_
        trees.append([[int(t.feature[i]), float(t.threshold[i]), int(t.children_left[i]), int(t.children_right[i]), float(t.value[i,0,0])*model.learning_rate] for i in range(t.node_count)])
    prior = model.init_.class_prior_[1]
    exported = {'version': 1, 'kind': 'gradient-boosted-component-classifier', 'featureNames': data['names'], 'bias': float(np.log(prior/(1-prior))), 'trees': trees, 'threshold': .9, 'training': {'pages': pages, 'labeledComponents': len(train), 'positiveComponents': int(y.sum()), 'source': 'ten local third-party comparison pairs; sparse reviewed weak labels', 'seed': 20261102, 'featureDataSha256': hashlib.sha256(source.read_bytes()).hexdigest()}, 'limitations': ['Small English workbook dataset; not a general Chinese/Zhuyin model', 'Comparison outputs contain defects and are not clean ground truth', 'Cannot infer hidden original printed pixels']}
    # Independent export evaluator verifies every sample, including unused candidates.
    def infer(features):
        score = exported['bias']
        for tree in trees:
            i = 0
            while tree[i][0] >= 0:
                f, threshold, left, right, _ = tree[i]
                i = left if np.float32(features[f]) <= threshold else right
            score += tree[i][4]
        return 1/(1+np.exp(-score))
    all_x = np.array([r['features'] for r in data['records']])
    probabilities = model.predict_proba(all_x)[:,1]
    export_values = np.array([infer(r) for r in all_x])
    assert np.max(np.abs(export_values-probabilities)) < 1e-10
    scores = {}
    reports = []
    for r, prob in zip(data['records'], probabilities):
        scores.setdefault(r['page'], []).append(float(prob))
    for page, values in scores.items():
        np.array(values, np.float32).tofile(args.dataset / page / 'learned-scores')
    for split in ['train', 'validation', 'test']:
        selected = [i for i,r in enumerate(data['records']) if r['split']==split and r['label'] is not None]
        truth = np.array([data['records'][i]['label'] for i in selected])
        probs = probabilities[selected]
        reports.append({'split':split,'pages':pages[split],'components':len(selected),'positive':int(truth.sum()),'thresholds':[{'threshold':t,'precision':float(precision_score(truth,probs>=t,zero_division=0)),'recall':float(recall_score(truth,probs>=t,zero_division=0)),'falsePositiveComponents':int(((probs>=t)&(truth==0)).sum())} for t in [.5,.65,.8,.9,.95]]})
    (args.dataset / 'ink-model.json').write_text(json.dumps(exported,separators=(',',':')),encoding='utf-8')
    report = {'kind':'sparse-reviewed-weak-label-component-evaluation-not-whole-page-accuracy','reports':reports,'featureImportance':dict(sorted(zip(data['names'],model.feature_importances_.tolist()),key=lambda x:-x[1])),'exportMaxError':float(np.max(np.abs(export_values-probabilities)))}
    (args.dataset / 'training-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2),flush=True)


if __name__ == '__main__':
    main()
