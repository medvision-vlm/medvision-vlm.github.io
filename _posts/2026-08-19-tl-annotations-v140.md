---
layout: default
title: "MedVision v1.4.0: 50× More Tumor/Lesion Measurements and Their Annotation Recall"
description: "Dataset v1.4.0 selects tumor and lesion measurements by physical size in millimetres instead of pixel count, growing published measurements from 75,840 to 3,801,540, and quantifies annotation recall by cluster length and by cluster area."
---

<div class="mv-post-head">
  <a class="mv-post-back" href="{{ '/blog.html' | relative_url }}"><i class="fas fa-arrow-left"></i> All posts</a>
  <time class="mv-post-date" datetime="2026-08-21">Aug 21, 2026</time>
</div>

# MedVision v1.4.0: 50× More Tumor/Lesion Measurements and Their Annotation Recall

**Summary.** Dataset `v1.4.0` rebuilds the tumor/lesion (T/L) size annotations of all 12 tumor and lesion collections. Clusters are selected by a physical size floor in millimetres instead of a raw pixel count, a containment test that discarded rotated ellipses is removed, and four guards bracket the ellipse fit. Published measurements increase from **75,840 to 3,801,540 (50×)**. This release also quantifies annotation recall for the first time: of 6,951,667 outlined clusters, 3,801,540 (0.547) carry a measurement, and recall reaches 0.992 for clusters at least 20 mm long.

## Background

Tumor and lesion size is a quantitative clinical endpoint. It informs staging, treatment selection, and response assessment across successive scans. MedVision evaluates whether vision language models can recover that quantity from medical images, which requires a reference standard: a large image corpus in which the physical size of each tumor or lesion is known.

## Measurement procedure

Every volume in these collections carries expert segmentation masks of diseased tissue. On each slice, every connected component of a target-label mask (a *cluster*) is fitted with an ellipse, and the major and minor axis lengths are recorded in millimetres, mirroring how a radiologist sizes a lesion. Those lengths are the reference values against which a model is graded.

Because the fit is automatic, the rules that decide *which clusters are measured* and *which fits are trustworthy* determine the composition of the dataset. v1.4.0 revises those rules.

## Changes in v1.4.0

No measurement published by an earlier version was incorrect. The earlier rules were restrictive in ways that left many measurable lesions out, and the extent of that loss had never been quantified.

**1. Selection in millimetres rather than pixels.** A pixel is not a fixed physical size: it varies between scanners and between viewing directions within one volume. On a case of 0.977/0.977/3.0 mm spacing, the earlier 20 px floor cut at approximately 4.9 mm in the axial plane but 8.6 mm in the sagittal plane, a 3.07× difference in area behind a single number. v1.4.0 measures a cluster when its fitted major axis clears `max(2.0 mm, 2× the coarser in-plane spacing)`, a resolution floor applied identically to every image.

**2. Removal of the orientation-sensitive containment test.** The earlier rule required the fitted ellipse to lie inside a box around the cluster, which tests shape and rotation rather than size: a tilted ellipse protrudes from an axis-aligned box regardless of fit quality. Most of the 50× growth is attributable to this removal rather than to the lower floor.

**3. Four guards on the fit.** Fitting millions of contours automatically admits rare degenerate solutions. v1.4.0 rejects contours under 5 points, non-finite conics, minor axes thinner than one voxel, and major axes exceeding 1.5× the cluster's own bounding-box diagonal. The logged guards rejected 95,800 fits corpus-wide.

## Measurement distribution

<div class="mv-post-fig">
  <img src="{{ '/figure/blog/tl-v140-overview-major-axis.svg' | relative_url }}"
       alt="Box plot of major axis distributions for all 38 tumor and lesion types in MedVision v1.4.0">
  <p class="mv-post-figcap">
    Distribution of the major axis for all 3,801,540 measurements. Each row is one of
    the 38 tumor or lesion labels; the box spans the interquartile range and the
    whiskers the central 90%, in millimetres.
  </p>
</div>

The median major axis spans 7.7 mm (non-enhancing brain tumor core, BraTS24-GLI) to 43.3 mm (kidney tumor, KiTS23), so a single expected size does not generalise across diseases. The largest measurement in the corpus, 540.1 mm.

## Annotation recall

Recall is measured clusters divided by all clusters, with the denominator obtained by recounting the expert masks directly rather than by reading the annotation plan. Across the 12 collections the masks contain **6,951,667** clusters, of which **3,801,540 (0.547)** carry a measurement.

The unmeasured remainder is dominated by fragments: **95.5% of unmeasured clusters are ≤10 px and 84.7% are ≤5 px**. The corpus value of 0.547 therefore counts components, not clinically measurable lesions. The two stratifications below separate the two quantities; each partitions the same 6,951,667 clusters and reproduces the same margins.

### Recall by major axis length

Length is the maximum Feret diameter of a cluster in millimetres, the mask-side proxy for the fitted major axis on which the selection rule acts. Each in-plane axis is scaled by its own spacing.

<table>
  <thead>
    <tr>
      <th colspan="4"><b>Per bin</b></th>
      <th colspan="4"><b>Cumulative recall (&le; t)</b></th>
      <th colspan="4"><b>Recall above threshold (&gt; t)</b></th>
    </tr>
    <tr><th><b>Cluster length</b></th><th><b>Clusters</b></th><th><b>Measured</b></th><th><b>Recall</b></th><th><b>Cluster length</b></th><th><b>Clusters</b></th><th><b>Measured</b></th><th><b>Recall</b></th><th><b>Cluster length</b></th><th><b>Clusters</b></th><th><b>Measured</b></th><th><b>Recall</b></th></tr>
  </thead>
  <tbody>
    <tr><td>≤2 mm</td><td>2,232,427</td><td>1,952</td><td>0.001</td><td>≤2 mm</td><td>2,232,427</td><td>1,952</td><td>0.001</td><td>&gt;2 mm</td><td>4,719,240</td><td>3,799,588</td><td>0.805</td></tr>
    <tr><td>2–5 mm</td><td>974,881</td><td>409,412</td><td>0.420</td><td>≤5 mm</td><td>3,207,308</td><td>411,364</td><td>0.128</td><td>&gt;5 mm</td><td>3,744,359</td><td>3,390,176</td><td>0.905</td></tr>
    <tr><td>5–10 mm</td><td>955,724</td><td>694,683</td><td>0.727</td><td>≤10 mm</td><td>4,163,032</td><td>1,106,047</td><td>0.266</td><td><b>&gt;10 mm</b></td><td>2,788,635</td><td>2,695,493</td><td><b>0.967</b></td></tr>
    <tr><td>10–20 mm</td><td>1,055,235</td><td>976,105</td><td>0.925</td><td>≤20 mm</td><td>5,218,267</td><td>2,082,152</td><td>0.399</td><td><b>&gt;20 mm</b></td><td>1,733,400</td><td>1,719,388</td><td><b>0.992</b></td></tr>
    <tr><td>20–50 mm</td><td>1,263,241</td><td>1,250,268</td><td>0.990</td><td>≤50 mm</td><td>6,481,508</td><td>3,332,420</td><td>0.514</td><td>&gt;50 mm</td><td>470,159</td><td>469,120</td><td>0.998</td></tr>
    <tr><td>50–100 mm</td><td>413,816</td><td>412,849</td><td>0.998</td><td>≤100 mm</td><td>6,895,324</td><td>3,745,269</td><td>0.543</td><td>&gt;100 mm</td><td>56,343</td><td>56,271</td><td>0.999</td></tr>
    <tr><td>&gt;100 mm</td><td>56,343</td><td>56,271</td><td>0.999</td><td><b>All</b></td><td><b>6,951,667</b></td><td><b>3,801,540</b></td><td><b>0.547</b></td><td></td><td></td><td></td><td></td></tr>
  </tbody>
</table>

The first block is the recall of each bin in isolation. The second accumulates the bins upward from the smallest, the cumulative recall in the usual sense, and closes on the corpus total. The third pools every cluster above a threshold, which is the quantity a user of the dataset sees when selecting lesions above a size floor; the second and third blocks at one threshold partition the corpus exactly. Read from the third block, **recall is 0.967 for clusters >10 mm and 0.992 for clusters >20 mm**.


### Recall by cluster area

Area is the physical area of the cluster on its slice in mm², derived from the same recount.

<table>
  <thead>
    <tr>
      <th colspan="4"><b>Per bin</b></th>
      <th colspan="4"><b>Cumulative recall (&le; t)</b></th>
      <th colspan="4"><b>Recall above threshold (&gt; t)</b></th>
    </tr>
    <tr><th><b>Cluster area</b></th><th><b>Clusters</b></th><th><b>Measured</b></th><th><b>Recall</b></th><th><b>Cluster area</b></th><th><b>Clusters</b></th><th><b>Measured</b></th><th><b>Recall</b></th><th><b>Cluster area</b></th><th><b>Clusters</b></th><th><b>Measured</b></th><th><b>Recall</b></th></tr>
  </thead>
  <tbody>
    <tr><td>≤2 mm²</td><td>1,684,011</td><td>64</td><td>0.000</td><td>≤2 mm²</td><td>1,684,011</td><td>64</td><td>0.000</td><td>&gt;2 mm²</td><td>5,267,656</td><td>3,801,476</td><td>0.722</td></tr>
    <tr><td>2–5 mm²</td><td>696,041</td><td>40,093</td><td>0.058</td><td>≤5 mm²</td><td>2,380,052</td><td>40,157</td><td>0.017</td><td>&gt;5 mm²</td><td>4,571,615</td><td>3,761,383</td><td>0.823</td></tr>
    <tr><td>5–10 mm²</td><td>526,878</td><td>237,702</td><td>0.451</td><td>≤10 mm²</td><td>2,906,930</td><td>277,859</td><td>0.096</td><td>&gt;10 mm²</td><td>4,044,737</td><td>3,523,681</td><td>0.871</td></tr>
    <tr><td>10–20 mm²</td><td>545,631</td><td>371,569</td><td>0.681</td><td>≤20 mm²</td><td>3,452,561</td><td>649,428</td><td>0.188</td><td>&gt;20 mm²</td><td>3,499,106</td><td>3,152,112</td><td>0.901</td></tr>
    <tr><td>20–50 mm²</td><td>725,574</td><td>530,074</td><td>0.731</td><td>≤50 mm²</td><td>4,178,135</td><td>1,179,502</td><td>0.282</td><td>&gt;50 mm²</td><td>2,773,532</td><td>2,622,038</td><td>0.945</td></tr>
    <tr><td>50–100 mm²</td><td>582,689</td><td>467,469</td><td>0.802</td><td>≤100 mm²</td><td>4,760,824</td><td>1,646,971</td><td>0.346</td><td><b>&gt;100 mm²</b></td><td>2,190,843</td><td>2,154,569</td><td><b>0.983</b></td></tr>
    <tr><td>100–500 mm²</td><td>1,347,005</td><td>1,311,216</td><td>0.973</td><td>≤500 mm²</td><td>6,107,829</td><td>2,958,187</td><td>0.484</td><td><b>&gt;500 mm²</b></td><td>843,838</td><td>843,353</td><td><b>0.999</b></td></tr>
    <tr><td>500–1000 mm²</td><td>428,510</td><td>428,120</td><td>0.999</td><td>≤1000 mm²</td><td>6,536,339</td><td>3,386,307</td><td>0.518</td><td>&gt;1000 mm²</td><td>415,328</td><td>415,233</td><td>1.000</td></tr>
    <tr><td>&gt;1000 mm²</td><td>415,328</td><td>415,233</td><td>1.000</td><td><b>All</b></td><td><b>6,951,667</b></td><td><b>3,801,540</b></td><td><b>0.547</b></td><td></td><td></td><td></td><td></td></tr>
  </tbody>
</table>

Read from the third block as before, **recall reaches 0.983 for clusters >100 mm² and 0.999 for clusters >500 mm²**. Area does not determine the major axis: at a fixed area an elongated cluster has a longer major axis than a compact one and is more likely to clear the floor, while the thinnest clusters are removed by the sub-voxel minor-axis guard. Length, the variable the rule acts on, is therefore the sharper predictor of recall, and the area view describes the same corpus with shapes mixed together.

<div class="mv-post-fig">
  <img src="{{ '/figure/blog/tl-v140-overview-recall.svg' | relative_url }}"
       alt="Recall of tumor and lesion measurements against cluster area and cluster length, one curve per collection, MedVision v1.4.0">
  <p class="mv-post-figcap">
    Recall against cluster area (left) and cluster length (right), one curve per
    collection. Both panels stratify the same 6,951,667 clusters. Recall rises with
    size in every collection and is at least 0.972 for clusters >20 mm long.
  </p>
</div>

## Implications for users

The images are unchanged; only the T/L measurements were rebuilt. They are larger in number, selected consistently across scans and viewing directions, and free of degenerate values. Every earlier annotation version (`<1.4.0`) remains published unchanged, so previous results stay reproducible.

One caveat applies to comparisons. Case counts per split are unchanged, but train/test membership changes for six collections (autoPET-III, BraTS24, HNTSMRG24, KiPA22, KiTS23, MSD), whose earlier splits had been force-aligned to `v1.0.0`. A v1.4.0 test metric should not be compared against a pre-1.4.0 one on those six.

The [full release note](https://huggingface.co/datasets/YongchengYAO/MedVision/blob/main/doc/release-v1.4.0.md){:target="_blank" rel="noopener"} documents every rule, number, and verification behind this post.
